'use client';

import { useEffect, useState } from 'react';
import AdminDashboard from './AdminDashboard';

export default function AdminPage() {
  const [themeColor, setThemeColor] = useState('#00A3A2');
  useEffect(() => {
    const read = () => {
      const s = localStorage.getItem('mks_theme');
      if (s) setThemeColor(s);
    };
    read();
    const onFocus = () => read();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return <AdminDashboard themeColor={themeColor} />;
}
