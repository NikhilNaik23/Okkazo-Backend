package com.okkazo.authservice.services;

import com.okkazo.authservice.dtos.ForgotPasswordRequestDto;
import com.okkazo.authservice.dtos.ForgotPasswordResponseDto;
import com.okkazo.authservice.dtos.ResetPasswordRequestDto;
import com.okkazo.authservice.dtos.ResetPasswordResponseDto;
import com.okkazo.authservice.exceptions.AccountBlockedException;
import com.okkazo.authservice.exceptions.InvalidTokenException;
import com.okkazo.authservice.exceptions.TokenExpiredException;
import com.okkazo.authservice.exceptions.UserNotFoundException;
import com.okkazo.authservice.kafka.AuthEventProducer;
import com.okkazo.authservice.models.Auth;
import com.okkazo.authservice.models.AuthProvider;
import com.okkazo.authservice.models.PasswordResetToken;
import com.okkazo.authservice.models.Status;
import com.okkazo.authservice.repositories.AuthRepository;
import com.okkazo.authservice.repositories.PasswordResetTokenRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class PasswordResetService {
    private final AuthRepository authRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthEventProducer authEventProducer;

    @Transactional
    public ForgotPasswordResponseDto forgotPassword(ForgotPasswordRequestDto requestDto) {
        // Find user by email
        Auth user = authRepository.findByEmailIgnoreCase(requestDto.email().trim())
                .orElseThrow(() -> new UserNotFoundException("No account found with this email"));

        // Check if account is blocked
        if (user.getStatus() == Status.BLOCKED) {
            throw new AccountBlockedException("Your account has been blocked. Please contact support.");
        }

        // Check for existing valid token
        PasswordResetToken existingToken = passwordResetTokenRepository
                .findTopByUserOrderByCreatedAtDesc(user)
                .orElse(null);

        if (existingToken != null &&
            !existingToken.isUsed() &&
            existingToken.getExpiresAt().isAfter(LocalDateTime.now())) {
            // Token still valid, resend the same event (security: don't reveal this info)
            log.info("Password reset token still valid for user: {}", user.getEmail());
        }

        // Create new reset token
        String rawToken = UUID.randomUUID().toString();
        PasswordResetToken resetToken = new PasswordResetToken();
        resetToken.setUser(user);
        resetToken.setHashedToken(passwordEncoder.encode(rawToken));
        resetToken.setExpiresAt(LocalDateTime.now().plusMinutes(30)); // 30 minutes validity
        resetToken.setUsed(false);

        passwordResetTokenRepository.save(resetToken);

        // Send event to Node.js service for email
        authEventProducer.passwordResetRequested(
                user.getAuthId(),
                user.getEmail(),
                rawToken
        );

        // Generic response for security (don't reveal if email exists)
        return new ForgotPasswordResponseDto(
                "If an account exists with this email, you will receive password reset instructions.",
                true
        );
    }

    @Transactional
    public ResetPasswordResponseDto resetPassword(ResetPasswordRequestDto requestDto) {
        // Find all password reset tokens and check against the raw token
        PasswordResetToken resetToken = passwordResetTokenRepository.findAll().stream()
                .filter(token -> !token.isUsed() &&
                               passwordEncoder.matches(requestDto.token(), token.getHashedToken()))
                .findFirst()
                .orElseThrow(() -> new InvalidTokenException("Invalid or already used reset token"));

        // Check if token is expired
        if (resetToken.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new TokenExpiredException("Reset token has expired. Please request a new one.");
        }

        // Get user
        Auth user = resetToken.getUser();

        // Check if account is blocked
        if (user.getStatus() == Status.BLOCKED) {
            throw new AccountBlockedException("Your account has been blocked. Please contact support.");
        }

        // Update password
        user.setHashedPassword(passwordEncoder.encode(requestDto.newPassword()));

        if (user.getAuthProvider() == AuthProvider.SIGN_IN_WITH_GOOGLE) {
            user.setAuthProvider(AuthProvider.BOTH);
        }
        
        // Auto-verify vendors and managers when they set their password for the first time
        if ((user.getRole() == com.okkazo.authservice.models.Role.VENDOR ||
             user.getRole() == com.okkazo.authservice.models.Role.MANAGER) && !user.getIsVerified()) {
            user.setIsVerified(true);
            user.setStatus(Status.ACTIVE);
            log.info("Auto-verified {} account after password setup: {}", user.getRole(), user.getEmail());
        }
        
        authRepository.save(user);

        // Mark token as used
        resetToken.setUsed(true);
        passwordResetTokenRepository.save(resetToken);

        log.info("Password successfully reset for user: {}", user.getEmail());

        return new ResetPasswordResponseDto(
                "Password has been reset successfully. You can now login with your new password.",
                true
        );
    }
}
