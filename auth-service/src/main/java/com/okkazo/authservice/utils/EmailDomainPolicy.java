package com.okkazo.authservice.utils;

import java.util.Set;

public final class EmailDomainPolicy {
    private static final Set<String> ALLOWED_DOMAINS = Set.of(
            "gmail.com",
            "outlook.com",
            "yahoo.com",
            "hotmail.com"
    );

    private EmailDomainPolicy() {
    }

    public static boolean isAllowedDomain(String email) {
        String domain = extractDomain(email);
        return !domain.isEmpty() && ALLOWED_DOMAINS.contains(domain);
    }

    public static String allowedDomainsMessage() {
        return "Email domain must be gmail.com, outlook.com, yahoo.com, or hotmail.com.";
    }

    private static String extractDomain(String email) {
        if (email == null) {
            return "";
        }

        String normalized = email.trim().toLowerCase();
        int atIndex = normalized.lastIndexOf('@');
        if (atIndex < 0 || atIndex == normalized.length() - 1) {
            return "";
        }

        return normalized.substring(atIndex + 1);
    }
}
