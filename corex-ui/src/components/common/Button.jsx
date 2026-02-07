import React from 'react';

const Button = ({ children, onClick, className, variant = 'primary', ...rest }) => {
  const variants = {
    primary: 'ui-button ui-button-primary',
    secondary: 'ui-button ui-button-secondary',
    danger: 'ui-button ui-button-danger',
  };

  return (
    <button
      onClick={onClick}
      className={`${variants[variant]} ${className || ''}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export default Button;
