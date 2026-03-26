package com.okkazo.authservice.utils;

import java.util.regex.Pattern;

public final class PasswordPolicy {
    private PasswordPolicy() {}

    public static final String PASSWORD_REGEX = "^(?=.*[A-Z])(?=.*[A-Za-z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,72}$";

    public static final String MESSAGE =
            "Password must be at least 8 characters and include 1 uppercase letter, letters, numbers, and special characters";

    private static final Pattern PASSWORD_PATTERN = Pattern.compile(PASSWORD_REGEX);

    public static boolean isStrong(String password) {
        return password != null && PASSWORD_PATTERN.matcher(password).matches();
    }
}
