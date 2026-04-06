package com.okkazo.authservice.dtos;

import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.web.multipart.MultipartFile;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class VendorRegisterRequestDto {
    
    @NotBlank(message = "Business name is required")
    @Size(min = 2, max = 200, message = "Business name must be between 2 and 200 characters")
    private String businessName;
    
    @NotBlank(message = "Service category is required")
    private String serviceCategory;
    
    private String customService; // Required only if serviceCategory is "Other"
    
    @NotBlank(message = "Email is required")
    @Email(message = "Email should be valid")
    private String email;
    
    @NotBlank(message = "Phone number is required")
    @Pattern(regexp = "^[+]?[0-9]{10,15}$", message = "Phone number should be valid")
    private String phone;

    private String phoneVerificationToken;
    
    @NotBlank(message = "Location is required")
    @Size(min = 2, max = 500, message = "Location must be between 2 and 500 characters")
    private String location;
    
    @Size(max = 200, message = "Place cannot exceed 200 characters")
    private String place; // City or primary place
    
    @Size(max = 200, message = "Country cannot exceed 200 characters")
    private String country;
    
    private Double latitude;
    
    private Double longitude;
    
    @Size(max = 2000, message = "Description cannot exceed 2000 characters")
    private String description;
    
    // File fields - will be handled separately in controller
    private MultipartFile businessLicense;
    
    private MultipartFile ownerIdentity;
    
    private MultipartFile[] otherProofs;
    
    @NotNull(message = "You must agree to terms and conditions")
    @AssertTrue(message = "You must agree to terms and conditions")
    private Boolean agreedToTerms;
}
