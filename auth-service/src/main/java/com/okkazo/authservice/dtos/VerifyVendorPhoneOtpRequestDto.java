package com.okkazo.authservice.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record VerifyVendorPhoneOtpRequestDto(
        @NotBlank(message = "Phone number is required")
        @Pattern(regexp = "^[+]?[0-9]{10,15}$", message = "Phone number should be valid")
        String phone,
        @NotBlank(message = "OTP is required")
        @Pattern(regexp = "^[0-9]{4,10}$", message = "OTP should contain only numbers")
        String otp
) {
}
