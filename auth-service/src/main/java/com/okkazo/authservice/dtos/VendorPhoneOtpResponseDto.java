package com.okkazo.authservice.dtos;

public record VendorPhoneOtpResponseDto(
        String message,
        boolean success,
        String verificationToken
) {
}
