package com.okkazo.authservice.dtos;

public record LoginResponseDto(
        String accessToken,
        String refreshToken,
        String role,
        String authProvider,
        String message,
        boolean success
) {
}
