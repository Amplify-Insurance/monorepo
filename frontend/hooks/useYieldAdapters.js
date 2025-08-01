import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { YieldPlatform, getYieldPlatformInfo } from '../app/config/yieldPlatforms';
import { getTokenMetadata } from '../lib/erc20';

export default function useYieldAdapters(deployment) {
  const [adapters, setAdapters] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const url = deployment ? `/api/adapters?deployment=${deployment}` : '/api/adapters';
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const decimalsMap = {
            [YieldPlatform.AAVE]: 18, // Aave APR returned with 27 decimals
            [YieldPlatform.COMPOUND]: 18, // Compound uses 18 decimals
          };

          const list = await Promise.all(
            (data.adapters || []).map(async (item) => {
              let apr = 0;
              try {
                const decimals = decimalsMap[item.id] ?? 18;
                apr =
                  parseFloat(
                    ethers.utils.formatUnits(item.apr || '0', decimals),
                  ) * 100;
              } catch {}

              let symbol = '';
              try {
                const meta = await getTokenMetadata(item.asset);
                symbol = meta.symbol;
              } catch {}

              return {
                id: item.id,
                address: item.address,
                apr,
                asset: item.asset,
                assetSymbol: symbol,
                ...getYieldPlatformInfo(item.id),
              };
            }),
          );
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
  }, [deployment]);

  return adapters;
}
