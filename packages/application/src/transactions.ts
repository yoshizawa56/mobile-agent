export interface TransactionManager {
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}
