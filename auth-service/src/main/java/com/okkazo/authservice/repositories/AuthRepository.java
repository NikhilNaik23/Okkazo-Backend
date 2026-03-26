package com.okkazo.authservice.repositories;

import com.okkazo.authservice.models.Auth;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AuthRepository extends JpaRepository<Auth, UUID> {
    Optional<Auth> findByEmail(@NotBlank(message = "Email is required") @Email(message = "Invalid Email Format") String email);
    Optional<Auth> findByEmailIgnoreCase(String email);
    boolean existsByUsername(String username);
}
