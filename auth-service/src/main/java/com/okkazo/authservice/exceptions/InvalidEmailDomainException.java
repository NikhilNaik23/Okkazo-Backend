package com.okkazo.authservice.exceptions;

public class InvalidEmailDomainException extends IllegalArgumentException {
    public InvalidEmailDomainException(String message) {
        super(message);
    }
}
