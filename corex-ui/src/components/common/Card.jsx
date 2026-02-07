import React from 'react';

const Card = ({ title, children, className }) => {
  return (
    <div className={`ui-card ${className || ''}`}>
      {title && <h2 className="ui-panel-title mb-4">{title}</h2>}
      {children}
    </div>
  );
};

export default Card;
