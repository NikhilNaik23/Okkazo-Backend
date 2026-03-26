package com.okkazo.authservice.dtos;

import java.util.UUID;

public record UserGoogleRegisteredEvent(
        String type,
        UUID authId,
        String email,
        String username
) {
}
