package com.okkazo.authservice.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.okkazo.authservice.dtos.SendVendorPhoneOtpRequestDto;
import com.okkazo.authservice.dtos.VendorPhoneOtpResponseDto;
import com.okkazo.authservice.dtos.VerifyVendorPhoneOtpRequestDto;
import com.okkazo.authservice.exceptions.InvalidTokenException;
import com.okkazo.authservice.models.VendorPhoneVerificationToken;
import com.okkazo.authservice.repositories.VendorPhoneVerificationTokenRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class VendorPhoneOtpService {

    private final VendorPhoneVerificationTokenRepository vendorPhoneVerificationTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final ObjectMapper objectMapper;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Value("${twilio.account-sid:}")
    private String twilioAccountSid;

    @Value("${twilio.auth-token:}")
    private String twilioAuthToken;

    @Value("${twilio.verify-service-sid:}")
    private String twilioVerifyServiceSid;

    @Value("${twilio.otp.channel:sms}")
    private String twilioOtpChannel;

    @Value("${twilio.otp.verification-token-expiration-minutes:20}")
    private long verificationTokenExpiryMinutes;

    public VendorPhoneOtpResponseDto sendOtp(SendVendorPhoneOtpRequestDto requestDto) {
        ensureTwilioConfigured();

        String phone = normalizePhone(requestDto.phone());
        postTwilioVerifyRequest("Verifications", Map.of(
                "To", phone,
                "Channel", twilioOtpChannel
        ));

        return new VendorPhoneOtpResponseDto(
                "OTP sent to your phone successfully.",
                true,
                null
        );
    }

    @Transactional
    public VendorPhoneOtpResponseDto verifyOtp(VerifyVendorPhoneOtpRequestDto requestDto) {
        ensureTwilioConfigured();

        String phone = normalizePhone(requestDto.phone());
        JsonNode result = postTwilioVerifyRequest("VerificationCheck", Map.of(
                "To", phone,
                "Code", requestDto.otp().trim()
        ));

        String status = result.path("status").asText("");
        if (!"approved".equalsIgnoreCase(status)) {
            throw new InvalidTokenException("Invalid or expired OTP. Please request a new OTP and try again.");
        }

        String verificationToken = UUID.randomUUID().toString();
        VendorPhoneVerificationToken tokenEntity = new VendorPhoneVerificationToken();
        tokenEntity.setPhone(phone);
        tokenEntity.setTokenHash(passwordEncoder.encode(verificationToken));
        tokenEntity.setExpiresAt(LocalDateTime.now().plusMinutes(verificationTokenExpiryMinutes));
        tokenEntity.setConsumed(false);
        vendorPhoneVerificationTokenRepository.save(tokenEntity);

        return new VendorPhoneOtpResponseDto(
                "Phone number verified successfully.",
                true,
                verificationToken
        );
    }

    @Transactional
    public void consumeVerificationToken(String phoneInput, String verificationToken) {
        if (verificationToken == null || verificationToken.trim().isEmpty()) {
            throw new InvalidTokenException("Phone verification is required. Please verify your phone number first.");
        }

        String phone = normalizePhone(phoneInput);

        List<VendorPhoneVerificationToken> validTokens = vendorPhoneVerificationTokenRepository
                .findByPhoneAndConsumedFalseAndExpiresAtAfterOrderByCreatedAtDesc(phone, LocalDateTime.now());

        VendorPhoneVerificationToken matchingToken = validTokens.stream()
                .filter(token -> passwordEncoder.matches(verificationToken, token.getTokenHash()))
                .findFirst()
                .orElseThrow(() -> new InvalidTokenException("Phone verification expired or invalid. Please verify your phone number again."));

        matchingToken.setConsumed(true);
        matchingToken.setConsumedAt(LocalDateTime.now());
        vendorPhoneVerificationTokenRepository.save(matchingToken);
    }

    public String normalizePhone(String phone) {
        if (phone == null || phone.trim().isEmpty()) {
            throw new IllegalArgumentException("Phone number is required");
        }

        String normalized = phone.trim();
        if (normalized.startsWith("+")) {
            normalized = "+" + normalized.substring(1).replaceAll("[^0-9]", "");
        } else {
            normalized = "+" + normalized.replaceAll("[^0-9]", "");
        }

        if (!normalized.matches("^\\+[0-9]{10,15}$")) {
            throw new IllegalArgumentException("Phone number should be valid and include country code");
        }

        return normalized;
    }

    private JsonNode postTwilioVerifyRequest(String endpoint, Map<String, String> formData) {
        try {
            String body = formData.entrySet().stream()
                    .map(entry -> URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8)
                            + "=" + URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8))
                    .collect(Collectors.joining("&"));

            String url = "https://verify.twilio.com/v2/Services/" + twilioVerifyServiceSid + "/" + endpoint;
            String basicAuth = Base64.getEncoder().encodeToString(
                    (twilioAccountSid + ":" + twilioAuthToken).getBytes(StandardCharsets.UTF_8)
            );

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Basic " + basicAuth)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode responseBody = objectMapper.readTree(response.body());

            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                String message = responseBody.path("message").asText("Unable to process OTP request");
                String normalized = message.toLowerCase();

                if (normalized.contains("phone number is unverified")
                        || normalized.contains("trial accounts cannot send messages to unverified numbers")) {
                    throw new IllegalArgumentException(
                            "This phone number is not verified in your Twilio trial account. "
                                    + "Verify it in Twilio Console or use a Twilio account with verified messaging enabled."
                    );
                }

                if (response.statusCode() == 400 || response.statusCode() == 404 || response.statusCode() == 422) {
                    throw new InvalidTokenException(message);
                }

                if (response.statusCode() == 401 || response.statusCode() == 403) {
                    throw new IllegalStateException(
                            "Twilio credentials or Verify service configuration is invalid. "
                                    + "Please check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID."
                    );
                }

                throw new IllegalStateException("Twilio OTP request failed: " + message);
            }

            return responseBody;
        } catch (InvalidTokenException | IllegalArgumentException | IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            log.error("Twilio OTP request failed", ex);
            throw new IllegalStateException("Failed to process OTP verification right now. Please try again.");
        }
    }

    private void ensureTwilioConfigured() {
        if (twilioAccountSid == null || twilioAccountSid.isBlank()
                || twilioAuthToken == null || twilioAuthToken.isBlank()
                || twilioVerifyServiceSid == null || twilioVerifyServiceSid.isBlank()) {
            throw new IllegalStateException("Twilio OTP is not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.");
        }
    }
}
