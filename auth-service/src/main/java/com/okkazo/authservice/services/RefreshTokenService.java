package com.okkazo.authservice.services;

import com.okkazo.authservice.dtos.RefreshTokenRequestDto;
import com.okkazo.authservice.dtos.RefreshTokenResponseDto;
import com.okkazo.authservice.exceptions.InvalidTokenException;
import com.okkazo.authservice.exceptions.TokenExpiredException;
import com.okkazo.authservice.exceptions.UserNotFoundException;
import com.okkazo.authservice.models.Auth;
import com.okkazo.authservice.models.RefreshToken;
import com.okkazo.authservice.models.Status;
import com.okkazo.authservice.repositories.AuthRepository;
import com.okkazo.authservice.repositories.RefreshTokenRepository;
import com.okkazo.authservice.utils.JwtUtil;
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
public class RefreshTokenService {
    private final RefreshTokenRepository refreshTokenRepository;
    private final AuthRepository authRepository;
    private final JwtUtil jwtUtil;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public RefreshToken createRefreshToken(Auth user, String rawToken) {
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setUser(user);
        refreshToken.setHashedToken(passwordEncoder.encode(rawToken));
        refreshToken.setExpiresAt(LocalDateTime.now().plusDays(30)); // 30 days validity
        refreshToken.setRevoked(false);

        return refreshTokenRepository.save(refreshToken);
    }

    @Transactional
    public RefreshTokenResponseDto refreshAccessToken(RefreshTokenRequestDto requestDto) {
        try {
            // Validate JWT format
            if (!jwtUtil.validateToken(requestDto.refreshToken())) {
                throw new InvalidTokenException("Invalid or expired refresh token");
            }

            // Extract token ID and user ID from JWT
            UUID tokenId = jwtUtil.extractTokenId(requestDto.refreshToken());
            UUID userId = jwtUtil.extractUserId(requestDto.refreshToken());

            // Find refresh token in database
            RefreshToken refreshToken = refreshTokenRepository
                    .findByIdAndRevokedFalse(tokenId)
                    .orElseThrow(() -> new InvalidTokenException("Refresh token not found or revoked"));

            // Check if token is expired
            if (refreshToken.getExpiresAt().isBefore(LocalDateTime.now())) {
                refreshToken.setRevoked(true);
                refreshTokenRepository.save(refreshToken);
                throw new TokenExpiredException("Refresh token has expired");
            }

            // Verify user exists
            Auth user = authRepository.findById(userId)
                    .orElseThrow(() -> new UserNotFoundException("User not found"));

            if (user.getStatus() == Status.BLOCKED || user.getStatus() == Status.DELETED) {
                refreshToken.setRevoked(true);
                refreshTokenRepository.save(refreshToken);
                throw new InvalidTokenException("Account is blocked or inactive");
            }

            // Revoke old refresh token
            refreshToken.setRevoked(true);
            refreshTokenRepository.save(refreshToken);

            // Generate new tokens
            String newAccessToken = jwtUtil.generateAccessToken(
                    user.getAuthId(),
                    user.getEmail(),
                    user.getUsername(),
                    user.getRole().name()
            );

            // Create new refresh token
            String rawRefreshToken = UUID.randomUUID().toString();
            RefreshToken newRefreshToken = createRefreshToken(user, rawRefreshToken);
            String newRefreshTokenJwt = jwtUtil.generateRefreshToken(
                    user.getAuthId(),
                    newRefreshToken.getId()
            );

            return new RefreshTokenResponseDto(
                    newAccessToken,
                    newRefreshTokenJwt,
                    user.getAuthProvider() == null ? "EMAIL" : user.getAuthProvider().name(),
                    "Tokens refreshed successfully",
                    true
            );

        } catch (InvalidTokenException | TokenExpiredException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error refreshing token: ", e);
            throw new InvalidTokenException("Invalid refresh token");
        }
    }

    @Transactional
    public void revokeAllUserTokens(Auth user) {
        refreshTokenRepository.revokeAllActiveUserTokens(user);
    }
}
