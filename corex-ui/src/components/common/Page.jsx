import React from 'react';

const Page = ({ title, children }) => {
  return (
    <div className="ui-page">
      {title && <h1 className="ui-title">{title}</h1>}
      {children}
    </div>
  );
};

export default Page;
