package com.okkazo.authservice.repositories;

import com.okkazo.authservice.models.VendorPhoneVerificationToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public interface VendorPhoneVerificationTokenRepository extends JpaRepository<VendorPhoneVerificationToken, UUID> {
    List<VendorPhoneVerificationToken> findByPhoneAndConsumedFalseAndExpiresAtAfterOrderByCreatedAtDesc(
            String phone,
            LocalDateTime now
    );
}
