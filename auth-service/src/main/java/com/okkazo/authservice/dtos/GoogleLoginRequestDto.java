package com.okkazo.authservice.dtos;

import jakarta.validation.constraints.NotBlank;

public record GoogleLoginRequestDto(
        @NotBlank(message = "Google access token is required")
        String accessToken
) {
}
