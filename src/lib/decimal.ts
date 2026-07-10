export function decimalToNumber(value: { toNumber(): number }): number {
  return value.toNumber();
}
