package com.okkazo.authservice.validators;

import com.okkazo.authservice.dtos.VendorRegisterRequestDto;
import com.okkazo.authservice.models.ServiceCategory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.Arrays;

@Component
public class VendorRegistrationValidator {
    
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
        "^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"
    );
    
    private static final Pattern PHONE_PATTERN = Pattern.compile(
        "^[+]?[0-9]{10,15}$"
    );
    
    public List<String> validate(VendorRegisterRequestDto dto) {
        List<String> errors = new ArrayList<>();
        
        // Business Name validation
        if (dto.getBusinessName() == null || dto.getBusinessName().trim().isEmpty()) {
            errors.add("Business name is required");
        } else if (dto.getBusinessName().length() < 2 || dto.getBusinessName().length() > 200) {
            errors.add("Business name must be between 2 and 200 characters");
        }
        
        // Service Category validation
        if (dto.getServiceCategory() == null || dto.getServiceCategory().trim().isEmpty()) {
            errors.add("Service category is required");
        } else if (!ServiceCategory.isValid(dto.getServiceCategory())) {
            String validCategories = Arrays.stream(ServiceCategory.values())
                .map(ServiceCategory::getDisplayName)
                .collect(Collectors.joining(", "));
            errors.add("Invalid service category. Must be one of: " + validCategories);
        }
        
        // Custom Service validation (if serviceCategory is "Other")
        if ("Other".equalsIgnoreCase(dto.getServiceCategory())) {
            if (dto.getCustomService() == null || dto.getCustomService().trim().isEmpty()) {
                errors.add("Custom service description is required when service category is 'Other'");
            }
        }
        
        // Email validation
        if (dto.getEmail() == null || dto.getEmail().trim().isEmpty()) {
            errors.add("Email is required");
        } else if (!EMAIL_PATTERN.matcher(dto.getEmail()).matches()) {
            errors.add("Email should be valid");
        }
        
        // Phone validation
        if (dto.getPhone() == null || dto.getPhone().trim().isEmpty()) {
            errors.add("Phone number is required");
        } else if (!PHONE_PATTERN.matcher(dto.getPhone()).matches()) {
            errors.add("Phone number should be valid (10-15 digits)");
        }

        // Location validation
        if (dto.getLocation() == null || dto.getLocation().trim().isEmpty()) {
            errors.add("Location is required");
        } else if (dto.getLocation().length() < 2 || dto.getLocation().length() > 500) {
            errors.add("Location must be between 2 and 500 characters");
        }
        
        // Description validation (optional but has max length)
        if (dto.getDescription() != null && dto.getDescription().length() > 2000) {
            errors.add("Description cannot exceed 2000 characters");
        }
        
        // Terms agreement validation
        if (dto.getAgreedToTerms() == null || !dto.getAgreedToTerms()) {
            errors.add("You must agree to terms and conditions");
        }
        
        return errors;
    }
}
