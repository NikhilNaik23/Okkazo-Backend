package com.okkazo.apigateway.filter;

import com.okkazo.apigateway.util.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.factory.AbstractGatewayFilterFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

@Component
public class AuthenticationFilter extends AbstractGatewayFilterFactory<AuthenticationFilter.Config> {

    @Autowired
    private JwtUtil jwtUtil;

    @Value("${auth.service.url:http://auth-service:8081}")
    private String authServiceUrl;

    private final WebClient webClient = WebClient.builder().build();

    public AuthenticationFilter() {
        super(Config.class);
    }

    @Override
    public GatewayFilter apply(Config config) {
        return (exchange, chain) -> {
            ServerHttpRequest request = exchange.getRequest();

            // Check if Authorization header is present
            List<String> authHeaders = request.getHeaders().get(HttpHeaders.AUTHORIZATION);
            if (authHeaders == null || authHeaders.isEmpty()) {
                return onError(exchange, "Missing authorization header", HttpStatus.UNAUTHORIZED);
            }

            String authHeader = authHeaders.getFirst();

            // Check if Authorization header starts with "Bearer "
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                return onError(exchange, "Invalid authorization header format", HttpStatus.UNAUTHORIZED);
            }

            // Extract token
            String token = authHeader.substring(7);

            try {
                // Validate token
                if (!jwtUtil.validateToken(token)) {
                    return onError(exchange, "Invalid or expired token", HttpStatus.UNAUTHORIZED);
                }

                // Extract user information from token
                String userId = jwtUtil.extractUserId(token);
                String email = jwtUtil.extractEmail(token);
                String username = jwtUtil.extractUsername(token);
                String role = jwtUtil.extractRole(token);

                return webClient.get()
                        .uri(authServiceUrl + "/internal/account-status?authIds=" + userId)
                        .retrieve()
                        .bodyToMono(Map.class)
                        .flatMap(statusPayload -> {
                            String accountStatus = extractAccountStatus(statusPayload, userId);

                            if ("BLOCKED".equals(accountStatus) || "DELETED".equals(accountStatus)) {
                                return onError(exchange, "Account is blocked", HttpStatus.UNAUTHORIZED);
                            }

                            if ("UNKNOWN".equals(accountStatus)) {
                                return onError(exchange, "Unable to verify account status", HttpStatus.UNAUTHORIZED);
                            }

                            // Add user information to request headers for downstream services
                            ServerHttpRequest modifiedRequest = exchange.getRequest()
                                    .mutate()
                                    .header("X-Auth-Id", userId)  // authId (same as userId)
                                    .header("X-User-Id", userId)
                                    .header("X-User-Email", email)
                                    .header("X-User-Username", username)
                                    .header("X-User-Role", role)
                                    .build();

                            return chain.filter(exchange.mutate().request(modifiedRequest).build());
                        })
                        .onErrorResume(error -> onError(exchange, "Unable to verify account status", HttpStatus.UNAUTHORIZED));

            } catch (Exception e) {
                return onError(exchange, "Token validation failed: " + e.getMessage(), HttpStatus.UNAUTHORIZED);
            }
        };
    }

    private String extractAccountStatus(Map statusPayload, String userId) {
        if (statusPayload == null) {
            return "UNKNOWN";
        }

        Object dataObj = statusPayload.get("data");
        if (!(dataObj instanceof Map<?, ?> dataMap)) {
            return "UNKNOWN";
        }

        Object statusObj = dataMap.get(userId);
        if (statusObj == null) {
            return "UNKNOWN";
        }

        return String.valueOf(statusObj).toUpperCase();
    }

    private Mono<Void> onError(ServerWebExchange exchange, String message, HttpStatus httpStatus) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(httpStatus);
        response.getHeaders().add(HttpHeaders.CONTENT_TYPE, "application/json");

        String errorResponse = String.format(
            "{\"timestamp\":\"%s\",\"status\":%d,\"message\":\"%s\"}",
            java.time.LocalDateTime.now(),
            httpStatus.value(),
            message
        );

        return response.writeWith(
            Mono.just(response.bufferFactory().wrap(errorResponse.getBytes()))
        );
    }

    public static class Config {
        // Configuration properties can be added here if needed
    }
}
