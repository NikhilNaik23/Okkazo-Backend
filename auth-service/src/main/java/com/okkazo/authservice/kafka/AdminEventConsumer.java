package com.okkazo.authservice.kafka;

import com.okkazo.authservice.models.Auth;
import com.okkazo.authservice.models.PasswordResetToken;
import com.okkazo.authservice.models.Role;
import com.okkazo.authservice.models.Status;
import com.okkazo.authservice.repositories.AuthRepository;
import com.okkazo.authservice.repositories.PasswordResetTokenRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Slf4j
public class AdminEventConsumer {

    private final AuthRepository authRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthEventProducer authEventProducer;

    @KafkaListener(topics = "${kafka.admin-topic.name:admin_events}", groupId = "auth-service-group")
    public void consume(Map<String, Object> event) {
        try {
            String eventType = (String) event.get("type");
            log.info("Received admin event: {}", eventType);

            if ("MANAGER_CREATED".equals(eventType)) {
                handleManagerCreated(event);
            } else {
                log.warn("Unknown admin event type: {}", eventType);
            }
        } catch (Exception e) {
            log.error("Error processing admin event: {}", e.getMessage(), e);
        }
    }

    @Transactional
    private void handleManagerCreated(Map<String, Object> event) {
        String email = (String) event.get("email");
        String name = (String) event.get("name");
        String department = (String) event.get("department");
        String assignedRole = (String) event.get("assignedRole");

        log.info("Processing MANAGER_CREATED event for email: {}", email);

        // Check if email already exists
        if (authRepository.findByEmail(email).isPresent()) {
            log.warn("Email already exists for manager creation: {}", email);
            return;
        }

        // Create auth entry with MANAGER role
        Auth managerAuth = new Auth();
        managerAuth.setUsername(generateUsername(name, email));
        managerAuth.setEmail(email);
        managerAuth.setHashedPassword(passwordEncoder.encode(UUID.randomUUID().toString()));
        managerAuth.setIsVerified(false);
        managerAuth.setStatus(Status.UNVERIFIED);
        managerAuth.setRole(Role.MANAGER);

        authRepository.save(managerAuth);
        log.info("Manager auth entry created with authId: {}", managerAuth.getAuthId());

        // Generate password reset token
        String resetToken = UUID.randomUUID().toString();
        PasswordResetToken passwordResetToken = new PasswordResetToken();
        passwordResetToken.setUser(managerAuth);
        passwordResetToken.setHashedToken(passwordEncoder.encode(resetToken));
        passwordResetToken.setExpiresAt(LocalDateTime.now().plusDays(7));
        passwordResetToken.setUsed(false);
        passwordResetTokenRepository.save(passwordResetToken);

        // Publish MANAGER_ACCOUNT_CREATED event for email-service and user-service
        authEventProducer.managerAccountCreated(
                managerAuth.getAuthId(),
                email,
                resetToken,
                name,
                department,
                assignedRole
        );

        log.info("MANAGER_ACCOUNT_CREATED event published for: {}", email);
    }

    private String generateUsername(String name, String email) {
        String baseUsername = name.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
        if (baseUsername.length() < 3) {
            baseUsername = email.split("@")[0].replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
        }
        return baseUsername + "_" + UUID.randomUUID().toString().substring(0, 8);
    }
}
