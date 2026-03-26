package com.okkazo.authservice.dtos;

public record RefreshTokenResponseDto(
        String accessToken,
        String refreshToken,
        String authProvider,
        String message,
        boolean success
) {
}
