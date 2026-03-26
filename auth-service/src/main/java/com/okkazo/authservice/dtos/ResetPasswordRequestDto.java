package com.okkazo.authservice.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import static com.okkazo.authservice.utils.PasswordPolicy.MESSAGE;
import static com.okkazo.authservice.utils.PasswordPolicy.PASSWORD_REGEX;

public record ResetPasswordRequestDto(
        @NotBlank(message = "Token is required")
        String token,
        @NotBlank(message = "Password is required")
        @Size(min = 8, max = 72, message = "Password must have at least 8 characters")
        @Pattern(regexp = PASSWORD_REGEX, message = MESSAGE)
        String newPassword
) {
}
