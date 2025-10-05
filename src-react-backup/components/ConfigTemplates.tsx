import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface ConfigTemplate {
  id: string;
  name: string;
  content: string;
  client_type: string;
}

const ConfigTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);

  useEffect(() => {
    const fetchTemplates = async () => {
      const response = await axios.get('/api/config-templates');
      setTemplates(response.data.data);
    };
    fetchTemplates();
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Config Templates</h1>
      <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-4">
        Add Template
      </button>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Client Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {templates.map(template => (
              <tr key={template.id}>
                <td className="px-6 py-4 whitespace-nowrap">{template.name}</td>
                <td className="px-6 py-4 whitespace-nowrap">{template.client_type}</td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button className="text-indigo-600 hover:text-indigo-900 mr-2">Edit</button>
                  <button className="text-red-600 hover:text-red-900">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ConfigTemplates;