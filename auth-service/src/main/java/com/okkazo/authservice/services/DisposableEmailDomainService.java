package com.okkazo.authservice.services;

import com.nouveauxterritoires.services.kickbox.KickBoxApi;
import com.nouveauxterritoires.services.kickbox.model.ExtendedKickBoxResponse;
import com.nouveauxterritoires.services.kickbox.model.KickBoxResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class DisposableEmailDomainService {

    private static final long CACHE_TTL_MS = 5 * 60 * 1000;

    @Value("${kickbox.api-key:}")
    private String kickboxApiKey;

    @Value("${kickbox.verify-timeout-ms:5000}")
    private long verifyTimeoutMs;

    private final Map<String, CachedDisposableStatus> cache = new ConcurrentHashMap<>();
    private volatile KickBoxApi kickBoxApi;

    public boolean isDisposableEmail(String email) {
        String normalizedEmail = normalizeEmail(email);
        if (normalizedEmail.isBlank()) {
            return false;
        }

        CachedDisposableStatus cached = cache.get(normalizedEmail);
        if (cached != null && !cached.isExpired()) {
            return cached.disposable();
        }

        boolean disposable = verifyDisposableWithKickbox(normalizedEmail);
        cache.put(normalizedEmail, new CachedDisposableStatus(disposable, System.currentTimeMillis() + CACHE_TTL_MS));
        return disposable;
    }

    private boolean verifyDisposableWithKickbox(String email) {
        if (kickboxApiKey == null || kickboxApiKey.isBlank()) {
            throw new IllegalStateException("KICKBOX_API_KEY is missing. Configure it in backend/.env before registration.");
        }

        try {
            if (kickBoxApi == null) {
                synchronized (this) {
                    if (kickBoxApi == null) {
                        kickBoxApi = new KickBoxApi(kickboxApiKey.trim());
                    }
                }
            }

            Long timeout = verifyTimeoutMs > 0 ? verifyTimeoutMs : null;
            ExtendedKickBoxResponse response = kickBoxApi.verifyWithResponse(email, timeout);
            KickBoxResponse payload = response != null ? response.getKickboxResponse() : null;

            if (payload == null) {
                throw new IllegalStateException("Disposable email validation returned empty response");
            }

            return payload.isDisposable();
        } catch (Exception ex) {
            log.error("Disposable email validation failed for {}", email, ex);
            throw new IllegalStateException("Unable to validate email right now. Please try again.");
        }
    }

    private String normalizeEmail(String email) {
        if (email == null) {
            return "";
        }

        return email.trim().toLowerCase();
    }

    private record CachedDisposableStatus(boolean disposable, long expiresAtMs) {
        private boolean isExpired() {
            return System.currentTimeMillis() > expiresAtMs;
        }
    }
}
