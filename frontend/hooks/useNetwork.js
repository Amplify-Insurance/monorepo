"use client";
import { createContext, useContext, useState, useEffect } from 'react';
import { CHAIN_MAP } from '../app/config/chains';
import { setCurrentChainId as setTokenChain } from '../app/config/tokenNameMap';
import { setCurrentChainId as setProviderChain } from '../lib/provider';

const NetworkContext = createContext({ chainId: 8453, switchNetwork: () => {} });

export function NetworkProvider({ children }) {
  const [chainId, setChainId] = useState(8453);
  useEffect(() => {
    const stored = typeof window !== 'undefined' && window.localStorage.getItem('chainId');
    if (stored) {
      const id = parseInt(stored, 10);
      setChainId(id);
      setTokenChain(id);
      setProviderChain(id);
    }
  }, []);

  const switchNetwork = (id) => {
    setChainId(id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('chainId', id.toString());
    }
    setTokenChain(id);
    setProviderChain(id);
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <NetworkContext.Provider value={{ chainId, switchNetwork, chain: CHAIN_MAP[chainId] }}>
      {children}
    </NetworkContext.Provider>
  );
}

export const useNetwork = () => useContext(NetworkContext);
