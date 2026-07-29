import { isValidIsoDate } from '../../common/utils/date-time.utils';
import { ALLOWED_SYMBOLS } from '@shared/core';
import {
  type DebitOrCredit,
  type SpreadLegRequest,
  type SpreadRequest,
  type SpreadType,
} from '../../partner/spread-request.types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a spread request against the structural rules for its spread type.
 *
 * Rules:
 * - `vertical`: 2 legs, same optionType, same expiration, different strike, one long + one short
 * - `straddle`: 2 legs, same strike, same expiration, one call + one put, same direction
 * - `strangle`: 2 legs, different strike, same expiration, one call + one put, same direction
 * - `iron_condor`: 4 legs, same expiration, two call + two put, two long + two short, all different strike
 *
 * Also validates: symbol is in allowed set, expiration is valid ISO date, strike is positive.
 */
export function validateSpread(request: SpreadRequest): ValidationResult {
  if (!request.spreadType || !isValidSpreadType(request.spreadType)) {
    return { valid: false, error: `Invalid or unsupported spreadType: ${request.spreadType}` };
  }

  const symbol = request.symbol?.toUpperCase().trim();
  if (!symbol) {
    return { valid: false, error: 'Missing or invalid symbol' };
  }
  if (!ALLOWED_SYMBOLS.has(symbol)) {
    return { valid: false, error: `Symbol ${symbol} is not supported. Allowed symbols: ${[...ALLOWED_SYMBOLS].join(', ')}` };
  }

  if (!Array.isArray(request.legs) || request.legs.length === 0) {
    return { valid: false, error: 'Missing or empty legs array' };
  }

  for (let i = 0; i < request.legs.length; i++) {
    const leg = request.legs[i];
    const legError = validateLeg(leg, i);
    if (legError) return { valid: false, error: legError };
  }

  if (request.startDate !== undefined && !isValidIsoDate(request.startDate)) {
    return { valid: false, error: 'Invalid startDate. Expected YYYY-MM-DD.' };
  }
  if (request.endDate !== undefined && !isValidIsoDate(request.endDate)) {
    return { valid: false, error: 'Invalid endDate. Expected YYYY-MM-DD.' };
  }
  if (request.startDate && request.endDate && request.startDate > request.endDate) {
    return { valid: false, error: 'startDate must be less than or equal to endDate' };
  }

  return validateSpreadStructure(request.spreadType, request.legs);
}

function isValidSpreadType(value: unknown): value is SpreadType {
  return value === 'vertical' || value === 'straddle' || value === 'strangle' || value === 'iron_condor';
}

function validateLeg(leg: SpreadLegRequest, index: number): string | null {
  if (!leg || typeof leg !== 'object') {
    return `Leg ${index}: missing or invalid`;
  }
  if (!leg.expiration || !isValidIsoDate(leg.expiration)) {
    return `Leg ${index}: invalid expiration. Expected YYYY-MM-DD.`;
  }
  if (typeof leg.strike !== 'number' || !Number.isFinite(leg.strike) || leg.strike <= 0) {
    return `Leg ${index}: strike must be a positive number`;
  }
  if (leg.optionType !== 'call' && leg.optionType !== 'put') {
    return `Leg ${index}: optionType must be "call" or "put"`;
  }
  if (leg.direction !== 'long' && leg.direction !== 'short') {
    return `Leg ${index}: direction must be "long" or "short"`;
  }
  return null;
}

function validateSpreadStructure(spreadType: SpreadType, legs: SpreadLegRequest[]): ValidationResult {
  switch (spreadType) {
    case 'vertical':
      return validateVertical(legs);
    case 'straddle':
      return validateStraddle(legs);
    case 'strangle':
      return validateStrangle(legs);
    case 'iron_condor':
      return validateIronCondor(legs);
  }
}

function validateVertical(legs: SpreadLegRequest[]): ValidationResult {
  if (legs.length !== 2) {
    return { valid: false, error: 'Vertical spread requires exactly 2 legs' };
  }
  if (legs[0].optionType !== legs[1].optionType) {
    return { valid: false, error: 'Vertical spread requires both legs to have the same optionType' };
  }
  if (legs[0].expiration !== legs[1].expiration) {
    return { valid: false, error: 'Vertical spread requires both legs to have the same expiration' };
  }
  if (legs[0].strike === legs[1].strike) {
    return { valid: false, error: 'Vertical spread requires different strikes' };
  }
  if (legs[0].direction === legs[1].direction) {
    return { valid: false, error: 'Vertical spread requires one long and one short leg' };
  }
  return { valid: true };
}

function validateStraddle(legs: SpreadLegRequest[]): ValidationResult {
  if (legs.length !== 2) {
    return { valid: false, error: 'Straddle requires exactly 2 legs' };
  }
  if (legs[0].strike !== legs[1].strike) {
    return { valid: false, error: 'Straddle requires both legs to have the same strike' };
  }
  if (legs[0].expiration !== legs[1].expiration) {
    return { valid: false, error: 'Straddle requires both legs to have the same expiration' };
  }
  if (legs[0].optionType === legs[1].optionType) {
    return { valid: false, error: 'Straddle requires one call and one put' };
  }
  if (legs[0].direction !== legs[1].direction) {
    return { valid: false, error: 'Straddle requires both legs to have the same direction' };
  }
  return { valid: true };
}

function validateStrangle(legs: SpreadLegRequest[]): ValidationResult {
  if (legs.length !== 2) {
    return { valid: false, error: 'Strangle requires exactly 2 legs' };
  }
  if (legs[0].strike === legs[1].strike) {
    return { valid: false, error: 'Strangle requires different strikes' };
  }
  if (legs[0].expiration !== legs[1].expiration) {
    return { valid: false, error: 'Strangle requires both legs to have the same expiration' };
  }
  if (legs[0].optionType === legs[1].optionType) {
    return { valid: false, error: 'Strangle requires one call and one put' };
  }
  if (legs[0].direction !== legs[1].direction) {
    return { valid: false, error: 'Strangle requires both legs to have the same direction' };
  }
  return { valid: true };
}

function validateIronCondor(legs: SpreadLegRequest[]): ValidationResult {
  if (legs.length !== 4) {
    return { valid: false, error: 'Iron condor requires exactly 4 legs' };
  }

  const expirations = new Set(legs.map((l) => l.expiration));
  if (expirations.size !== 1) {
    return { valid: false, error: 'Iron condor requires all legs to have the same expiration' };
  }

  const strikes = new Set(legs.map((l) => l.strike));
  if (strikes.size !== 4) {
    return { valid: false, error: 'Iron condor requires all legs to have different strikes' };
  }

  const calls = legs.filter((l) => l.optionType === 'call');
  const puts = legs.filter((l) => l.optionType === 'put');
  if (calls.length !== 2 || puts.length !== 2) {
    return { valid: false, error: 'Iron condor requires exactly 2 calls and 2 puts' };
  }

  const longs = legs.filter((l) => l.direction === 'long');
  const shorts = legs.filter((l) => l.direction === 'short');
  if (longs.length !== 2 || shorts.length !== 2) {
    return { valid: false, error: 'Iron condor requires exactly 2 long and 2 short legs' };
  }

  return { valid: true };
}

/**
 * Computes the debit/credit classification from the leg structure.
 *
 * Rules:
 * - Vertical (calls): long strike < short strike → debit; else credit
 * - Vertical (puts): long strike > short strike → debit; else credit
 * - Straddle / Strangle: direction "long" → debit; "short" → credit
 * - Iron Condor: always credit
 */
export function classifyDebitOrCredit(
  spreadType: SpreadType,
  legs: SpreadLegRequest[],
): DebitOrCredit {
  switch (spreadType) {
    case 'vertical':
      return classifyVertical(legs);
    case 'straddle':
    case 'strangle':
      return legs[0].direction === 'long' ? 'debit' : 'credit';
    case 'iron_condor':
      return 'credit';
  }
}

function classifyVertical(legs: SpreadLegRequest[]): DebitOrCredit {
  const longLeg = legs.find((l) => l.direction === 'long');
  const shortLeg = legs.find((l) => l.direction === 'short');

  if (!longLeg || !shortLeg) {
    return 'credit';
  }

  if (longLeg.optionType === 'call') {
    return longLeg.strike < shortLeg.strike ? 'debit' : 'credit';
  } else {
    return longLeg.strike > shortLeg.strike ? 'debit' : 'credit';
  }
}
