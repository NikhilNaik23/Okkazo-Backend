package com.okkazo.authservice.services;

import com.okkazo.authservice.dtos.VendorRegisterRequestDto;
import com.okkazo.authservice.dtos.VendorRegisterResponseDto;
import com.okkazo.authservice.dtos.VendorRegistrationEvent;
import com.okkazo.authservice.exceptions.AlreadyExistingException;
import com.okkazo.authservice.exceptions.InvalidEmailDomainException;
import com.okkazo.authservice.kafka.AuthEventProducer;
import com.okkazo.authservice.models.Auth;
import com.okkazo.authservice.models.PasswordResetToken;
import com.okkazo.authservice.models.Role;
import com.okkazo.authservice.models.ServiceCategory;
import com.okkazo.authservice.models.Status;
import com.okkazo.authservice.repositories.AuthRepository;
import com.okkazo.authservice.repositories.PasswordResetTokenRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class VendorRegistrationService {
    
    private final FileUploadService fileUploadService;
    private final AuthEventProducer authEventProducer;
    private final AuthRepository authRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final DisposableEmailDomainService disposableEmailDomainService;
    private final VendorPhoneOtpService vendorPhoneOtpService;
    
    @Transactional
    public VendorRegisterResponseDto registerVendor(VendorRegisterRequestDto requestDto) {
        try {
            // Validate service category
            if (!ServiceCategory.isValid(requestDto.getServiceCategory())) {
                throw new IllegalArgumentException("Invalid service category: " + requestDto.getServiceCategory());
            }
            
            // Validate custom service if serviceCategory is "Other"
            if ("Other".equalsIgnoreCase(requestDto.getServiceCategory())) {
                if (requestDto.getCustomService() == null || requestDto.getCustomService().trim().isEmpty()) {
                    throw new IllegalArgumentException("Custom service description is required when service category is 'Other'");
                }
            }

            String normalizedEmail = normalizeEmail(requestDto.getEmail());
            if (disposableEmailDomainService.isDisposableEmail(normalizedEmail)) {
                throw new InvalidEmailDomainException("Temporary/disposable email addresses are not allowed. Please use a valid business email.");
            }

            requestDto.setEmail(normalizedEmail);
            requestDto.setPhone(vendorPhoneOtpService.normalizePhone(requestDto.getPhone()));
            
            // Check if email already exists
            if (authRepository.findByEmail(requestDto.getEmail()).isPresent()) {
                throw new AlreadyExistingException("Email already registered. Please login or use a different email.");
            }
            
            // Generate application ID
            String applicationId = UUID.randomUUID().toString();
            
            // Upload files to Cloudinary
            String businessLicenseUrl = uploadSingleFile(
                requestDto.getBusinessLicense(), 
                applicationId + "/business-license"
            );
            
            String ownerIdentityUrl = uploadSingleFile(
                requestDto.getOwnerIdentity(), 
                applicationId + "/owner-identity"
            );
            
            List<String> otherProofsUrls = uploadMultipleFiles(
                requestDto.getOtherProofs(), 
                applicationId + "/other-proofs"
            );
            
            // Create vendor account in Auth table
            Auth vendorAuth = createVendorAccount(requestDto, applicationId);
            
            // Generate password reset token for setting password
            String resetToken = UUID.randomUUID().toString();
            PasswordResetToken passwordResetToken = new PasswordResetToken();
            passwordResetToken.setUser(vendorAuth);
            passwordResetToken.setHashedToken(passwordEncoder.encode(resetToken));
            passwordResetToken.setExpiresAt(LocalDateTime.now().plusDays(7)); // 7 days to set password
            passwordResetToken.setUsed(false);
            passwordResetTokenRepository.save(passwordResetToken);
            
            log.info("Created vendor account with authId: {} for email: {}", vendorAuth.getAuthId(), vendorAuth.getEmail());
            
            // Create Kafka event for vendor-service
            VendorRegistrationEvent event = new VendorRegistrationEvent(
                "VENDOR_REGISTRATION_SUBMITTED",
                vendorAuth.getAuthId().toString(),
                applicationId,
                requestDto.getBusinessName(),
                requestDto.getServiceCategory(),
                requestDto.getCustomService(),
                requestDto.getEmail(),
                requestDto.getPhone(),
                requestDto.getLocation(),
                requestDto.getPlace(),
                requestDto.getCountry(),
                requestDto.getLatitude(),
                requestDto.getLongitude(),
                requestDto.getDescription(),
                businessLicenseUrl,
                ownerIdentityUrl,
                otherProofsUrls,
                requestDto.getAgreedToTerms(),
                LocalDateTime.now(),
                "PENDING_REVIEW"
            );
            
            // Send event to Kafka (vendor-service)
            authEventProducer.vendorRegistrationSubmitted(event);
            
            // Send email notification event to email-service
            authEventProducer.vendorAccountCreated(
                vendorAuth.getAuthId(),
                vendorAuth.getEmail(),
                resetToken,
                requestDto.getBusinessName(),
                applicationId
            );
            
            log.info("Vendor registration submitted successfully for email: {}, applicationId: {}", 
                requestDto.getEmail(), applicationId);
            
            // Build response
            return VendorRegisterResponseDto.builder()
                .success(true)
                .message("Registration application submitted successfully. Check your email to set your password and login.")
                .data(VendorRegisterResponseDto.VendorApplicationData.builder()
                    .applicationId(applicationId)
                    .status("PENDING_REVIEW")
                    .businessName(requestDto.getBusinessName())
                    .email(requestDto.getEmail())
                    .submittedAt(LocalDateTime.now())
                    .estimatedReviewTime("2-3 business days")
                    .build())
                .build();
                
        } catch (AlreadyExistingException e) {
            log.error("Email already exists: {}", e.getMessage());
            throw e;
        } catch (IllegalArgumentException e) {
            log.error("Validation error during vendor registration: {}", e.getMessage());
            throw e;
        } catch (IOException e) {
            log.error("Error uploading files during vendor registration: {}", e.getMessage());
            throw new RuntimeException("Failed to upload documents. Please try again.", e);
        } catch (Exception e) {
            log.error("Unexpected error during vendor registration: {}", e.getMessage());
            throw new RuntimeException("Registration failed. Please try again later.", e);
        }
    }
    
    private Auth createVendorAccount(VendorRegisterRequestDto requestDto, String applicationId) {
        // Generate username from business name or email
        String username = generateUsername(requestDto.getBusinessName(), requestDto.getEmail());
        
        // Create Auth entity with VENDOR role
        Auth vendorAuth = new Auth();
        vendorAuth.setUsername(username);
        vendorAuth.setEmail(requestDto.getEmail());
        vendorAuth.setHashedPassword(passwordEncoder.encode(UUID.randomUUID().toString())); // Temporary password
        vendorAuth.setIsVerified(false); // Will be verified when they set password
        vendorAuth.setStatus(Status.UNVERIFIED);
        vendorAuth.setRole(Role.VENDOR);
        
        return authRepository.save(vendorAuth);
    }
    
    private String generateUsername(String businessName, String email) {
        // Generate username from business name, remove special characters and spaces
        String baseUsername = businessName.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
        
        // If username is too short, use email prefix
        if (baseUsername.length() < 3) {
            baseUsername = email.split("@")[0].replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
        }
        
        // Ensure username is unique by appending random suffix
        String username = baseUsername + "_" + UUID.randomUUID().toString().substring(0, 8);
        
        return username;
    }

    private String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }
    
    private String uploadSingleFile(MultipartFile file, String subfolder) throws IOException {
        if (file == null || file.isEmpty()) {
            return null;
        }
        return fileUploadService.uploadFile(file, subfolder);
    }
    
    private List<String> uploadMultipleFiles(MultipartFile[] files, String subfolder) throws IOException {
        if (files == null || files.length == 0) {
            return Collections.emptyList();
        }
        return fileUploadService.uploadFiles(files, subfolder);
    }
}
