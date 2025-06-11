import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { getYieldPlatformInfo } from '../app/config/yieldPlatforms';

export default function useYieldAdapters() {
  const [adapters, setAdapters] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/adapters');
        if (res.ok) {
          const data = await res.json();
          const decimalsMap = {
            0: 27, // Aave APR returned with 27 decimals
            1: 18, // Compound uses 18 decimals
          };

          const list = (data.adapters || []).map((item, index) => {
            let apr = 0;
            try {
              const decimals = decimalsMap[index] ?? 18;
              apr = parseFloat(ethers.utils.formatUnits(item.apr || '0', decimals)) * 100;
            } catch {}
            return {
              id: index,
              address: item.address,
              apr,
              ...getYieldPlatformInfo(index),
            };
          });
          const filtered = list.filter(
            (a) => a.address && a.address !== '0x0000000000000000000000000000000000000000'
          );
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
