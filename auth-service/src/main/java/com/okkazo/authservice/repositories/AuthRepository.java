package com.okkazo.authservice.repositories;

import com.okkazo.authservice.models.Auth;
import com.okkazo.authservice.models.Role;
import com.okkazo.authservice.models.Status;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AuthRepository extends JpaRepository<Auth, UUID> {
    Optional<Auth> findByEmail(@NotBlank(message = "Email is required") @Email(message = "Invalid Email Format") String email);
    Optional<Auth> findByEmailIgnoreCase(String email);
    boolean existsByUsername(String username);
    List<Auth> findByAuthIdIn(List<UUID> authIds);

        @Query("""
                SELECT a FROM Auth a
                WHERE (:role IS NULL OR a.role = :role)
                    AND (
                        :search IS NULL OR :search = ''
                        OR LOWER(a.email) LIKE LOWER(CONCAT('%', :search, '%'))
                        OR LOWER(a.username) LIKE LOWER(CONCAT('%', :search, '%'))
                    )
                """)
        Page<Auth> findPlatformUsers(
                        @Param("role") Role role,
                        @Param("search") String search,
                        Pageable pageable
        );

        long countByRole(Role role);
        long countByStatus(Status status);
}
