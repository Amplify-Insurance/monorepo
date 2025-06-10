import { useState, useEffect } from 'react';
import { getYieldPlatformInfo } from '../app/config/yieldPlatforms';

export default function useYieldAdapters() {
  const [adapters, setAdapters] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/adapters');
        if (res.ok) {
          const data = await res.json();
          const list = (data.addresses || []).map((addr, index) => ({
            id: index,
            address: addr,
            ...getYieldPlatformInfo(index),
          }));
          const filtered = list.filter(a => a.address && a.address !== '0x0000000000000000000000000000000000000000');
          setAdapters(filtered);
        }
      } catch (err) {
        console.error('Failed to load yield adapters', err);
      }
    }
    load();
  }, []);

  return adapters;
}
