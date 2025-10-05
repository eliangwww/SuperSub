import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="h-16 bg-gray-200 mb-4 flex items-center justify-between px-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      {/* Placeholder for user actions/notifications */}
      <div>User Actions</div>
    </header>
  );
};

export default Header;