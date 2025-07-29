import { ethers } from 'ethers';
import CatPool from '../abi/BackstopPool.json';
import { getProvider, provider } from './provider';
import { getERC20WithSigner } from './erc20';
import deployments from '../app/config/deployments';

const DEFAULT_ADDRESS = deployments[0]?.backstopPool as string;

if (!DEFAULT_ADDRESS) {
  console.error('❌  BackstopPool address not configured');
  throw new Error('BackstopPool address not set');
}

export function getCatPool(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, CatPool.abi, getProvider(deployment));
}
export const catPool = getCatPool();

export function getCatPoolWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, getProvider(deployment));
  return new ethers.Contract(address, CatPool.abi, signer);
}

export async function getCatPoolWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(
    DEFAULT_ADDRESS,
    CatPool.abi,
    signer,
  );
}

export async function getUsdcAddress(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const cp = new ethers.Contract(
    address,
    ['function usdc() view returns (address)'],
    getProvider(deployment),
  );
  return await cp.usdc();
}

export async function getUsdcDecimals(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const addr = await getUsdcAddress(address, deployment);
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    getProvider(deployment),
  );
  return await token.decimals();
}

export async function getCatShareAddress(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const cp = new ethers.Contract(
    address,
    ['function catShareToken() view returns (address)'],
    getProvider(deployment),
  );
  return await cp.catShareToken();
}

export async function getCatShareDecimals(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const addr = await getCatShareAddress(address, deployment);
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    getProvider(deployment),
  );
  return await token.decimals();
}

/**
 * Deposit USDC into the Catastrophe Pool. Automatically approves the
 * BackstopPool contract if allowance is insufficient.
 */
export async function depositWithApproval(amount: ethers.BigNumberish) {
  const cp = await getCatPoolWithSigner();
  const usdcAddr = await getUsdcAddress();
  const token = await getERC20WithSigner(usdcAddr);
  const signerAddr = await token.signer.getAddress();
  const allowance = await token.allowance(signerAddr, cp.address);
  if (allowance.lt(amount)) {
    const approveTx = await token.approve(cp.address, amount);
    await approveTx.wait();
  }
  const tx = await cp.depositLiquidity(amount);
  await tx.wait();
  return tx;
}

/** Submit a withdrawal request for CatShare tokens. */
export async function requestWithdrawal(shares: ethers.BigNumberish) {
  const cp = await getCatPoolWithSigner();
  const tx = await cp.requestWithdrawal(shares);
  await tx.wait();
  return tx;
}

/** Draw funds from the Cat Pool once the cooldown period has passed. */
export async function drawFund(amount: ethers.BigNumberish) {
  const cp = await getCatPoolWithSigner();
  const tx = await cp.drawFund(amount);
  await tx.wait();
  return tx;
}

/** Cancel a pending withdrawal request. */
export async function cancelWithdrawal(requestIndex: number) {
  const cp = await getCatPoolWithSigner();
  const tx = await cp.cancelWithdrawalRequest(requestIndex);
  await tx.wait();
  return tx;
}



