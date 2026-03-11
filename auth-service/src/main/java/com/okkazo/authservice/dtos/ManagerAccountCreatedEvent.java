package com.okkazo.authservice.dtos;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ManagerAccountCreatedEvent {
    private String eventType; // "MANAGER_ACCOUNT_CREATED"
    private UUID authId;
    private String email;
    private String passwordResetToken;
    private String name;
    private String department;
    private String assignedRole;
}
