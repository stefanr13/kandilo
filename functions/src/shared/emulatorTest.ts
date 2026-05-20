export function isFunctionsEmulatorTestMode(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true'
    && process.env.KANDILO_FUNCTIONS_TEST_MODE === 'true';
}
