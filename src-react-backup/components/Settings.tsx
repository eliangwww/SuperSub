import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useToast } from '../hooks/useToast'; // Import the new useToast hook

interface Setting {
  key: string;
  value: string;
  type: string;
  category: string;
  description?: string;
}

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<Setting[]>([]);
  const toast = useToast();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await axios.get('/api/settings');
        setSettings(response.data.data);
      } catch (error) {
        toast({
          title: 'Error fetching settings',
          description: (error as Error).message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (key: string, newValue: string | number | boolean) => {
    setSettings(prevSettings =>
      prevSettings.map(setting =>
        setting.key === key ? { ...setting, value: String(newValue) } : setting
      )
    );
  };

  const handleSave = async () => {
    try {
      await axios.put('/api/settings', { settings: settings.map(({ key, value }) => ({ key, value })) });
      toast({
        title: 'Settings saved',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Error saving settings',
        description: (error as Error).message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const renderSettingInput = (setting: Setting) => {
    const inputClasses = "mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50";

    switch (setting.type) {
      case 'string':
        return (
          <input
            type="text"
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className={inputClasses}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            value={setting.value}
            onChange={(e) => handleChange(setting.key, Number(e.target.value))}
            className={inputClasses}
          />
        );
      case 'boolean':
        return (
          <input
            type="checkbox"
            checked={setting.value === 'true'}
            onChange={(e) => handleChange(setting.key, e.target.checked)}
            className="form-checkbox h-5 w-5 text-indigo-600"
          />
        );
      case 'multiline_string':
        return (
          <textarea
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            rows={5}
            className={inputClasses}
          />
        );
      default:
        return (
          <input
            type="text"
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className={inputClasses}
          />
        );
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Global Settings</h1>
      <div className="space-y-4">
        {settings.map(setting => (
          <div className="block" key={setting.key}>
            <label className="block text-sm font-medium text-gray-700">
              {setting.key} ({setting.description})
            </label>
            {renderSettingInput(setting)}
          </div>
        ))}
      </div>
      <button
        onClick={handleSave}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
      >
        Save Settings
      </button>
    </div>
  );
};

export default Settings;