package com.okkazo.authservice.dtos;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import static com.okkazo.authservice.utils.PasswordPolicy.MESSAGE;
import static com.okkazo.authservice.utils.PasswordPolicy.PASSWORD_REGEX;

public record RegisterRequestDto(
        @NotBlank(message = "Username is required")
        @Size(min = 3, max = 30, message = "Username must be between 3 and 30 characters")
        String username,
        @NotBlank(message = "Email is required")
        @Email(message = "Invalid Email Format")
        String email,
        @NotBlank(message = "Password is required")
        @Size(min = 8, max = 72, message = "Password must have at least 8 characters")
        @Pattern(regexp = PASSWORD_REGEX, message = MESSAGE)
        String password
) {
}
