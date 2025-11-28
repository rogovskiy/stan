"""
Financial Data Format Validator

Validates that financial data dictionaries follow the standardized format
used across data extraction services (SEC, Yahoo Finance, etc.).
"""

from typing import Dict, Any


def validate_financial_data_format(data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate that financial data follows the standard format
    
    Args:
        data: Dictionary containing financial data for a single period
        
    Returns:
        Dictionary with validation results:
        - valid: bool indicating if format is valid
        - errors: list of validation error messages
        - warnings: list of non-critical issues
    """
    errors = []
    warnings = []
    
    # Required top-level fields
    required_fields = ['fiscal_year', 'fiscal_quarter', 'quarter_key', 'period_end_date', 'data_source']
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing required field: {field}")
    
    # Validate fiscal_year is an integer
    if 'fiscal_year' in data and not isinstance(data['fiscal_year'], int):
        errors.append(f"fiscal_year must be an integer, got {type(data['fiscal_year']).__name__}")
    
    # Validate fiscal_quarter is 1-4
    if 'fiscal_quarter' in data:
        if not isinstance(data['fiscal_quarter'], int):
            errors.append(f"fiscal_quarter must be an integer, got {type(data['fiscal_quarter']).__name__}")
        elif data['fiscal_quarter'] not in [1, 2, 3, 4]:
            errors.append(f"fiscal_quarter must be 1-4, got {data['fiscal_quarter']}")
    
    # Validate quarter_key format (e.g., "2024Q1")
    if 'quarter_key' in data:
        if not isinstance(data['quarter_key'], str):
            errors.append(f"quarter_key must be a string, got {type(data['quarter_key']).__name__}")
        elif not (len(data['quarter_key']) >= 6 and 'Q' in data['quarter_key']):
            warnings.append(f"quarter_key format may be incorrect: {data['quarter_key']}")
    
    # Validate period_end_date format (YYYY-MM-DD)
    if 'period_end_date' in data:
        if not isinstance(data['period_end_date'], str):
            errors.append(f"period_end_date must be a string, got {type(data['period_end_date']).__name__}")
        elif len(data['period_end_date']) != 10 or data['period_end_date'].count('-') != 2:
            warnings.append(f"period_end_date format may be incorrect: {data['period_end_date']}")
    
    # Required statement sections
    required_sections = ['income_statement', 'balance_sheet', 'cash_flow_statement']
    for section in required_sections:
        if section not in data:
            errors.append(f"Missing required section: {section}")
        elif not isinstance(data[section], dict):
            errors.append(f"{section} must be a dictionary, got {type(data[section]).__name__}")
    
    # Validate numeric values in statements
    for section in required_sections:
        if section in data and isinstance(data[section], dict):
            for field, value in data[section].items():
                if value is not None and not isinstance(value, (int, float)):
                    warnings.append(f"{section}.{field} should be numeric, got {type(value).__name__}")
    
    # Check if data is empty
    if all(section in data and len(data[section]) == 0 for section in required_sections):
        warnings.append("All financial statement sections are empty")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings
    }
