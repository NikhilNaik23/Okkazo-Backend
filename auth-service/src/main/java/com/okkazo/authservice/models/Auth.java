package com.okkazo.authservice.models;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table( name = "users",
        indexes = {
            @Index(name = "idx_users_username",columnList = "username")
        } )
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class Auth {
    @Column(name = "auth_id")
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID authId;
    @Column(unique = true, nullable = false)
    private String username;
    @Column(unique = true, nullable = false)
    private String email;
    @Column(nullable = false, name = "password_hash")
    private String hashedPassword;

    @Column(name = "is_verified", nullable = false)
    private Boolean isVerified = false;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private Status status;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private Role role;

    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private AuthProvider authProvider;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist(){
        if(status == null) status = Status.UNVERIFIED;
        if(role == null) role = Role.USER;
        if(authProvider == null) authProvider = AuthProvider.EMAIL;
    }

}
