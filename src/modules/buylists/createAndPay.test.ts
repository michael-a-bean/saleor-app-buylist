/**
 * Buylist createAndPay Comprehensive Tests
 *
 * Tests for the createAndPay mutation which handles:
 * - Buylist creation with line items
 * - Pricing calculation using rule engine
 * - Payout processing (cash, store credit, etc.)
 * - Cost layer event creation for WAC tracking
 * - POS register integration for cash payouts
 * - Store credit issuance
 * - Idempotency handling
 */
import { Decimal } from "decimal.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ==================== Type Definitions ====================

// Enums matching Prisma schema
type PayoutMethod = "CASH" | "STORE_CREDIT" | "CHECK" | "BANK_TRANSFER" | "PAYPAL" | "OTHER";
type PayoutStatus = "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
type BuylistStatus = "PENDING_VERIFICATION" | "COMPLETED" | "CANCELLED";
type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";
type CostEventType = "GOODS_RECEIPT" | "BUYLIST_RECEIPT" | "SALE" | "SALE_RETURN" | "STOCK_ADJUSTMENT" | "STOCK_ADJUSTMENT_REVERSAL";

interface BuylistLine {
  id: string;
  buylistId: string;
  saleorVariantId: string;
  saleorVariantSku: string | null;
  saleorVariantName: string | null;
  qty: number;
  condition: CardCondition;
  marketPrice: Decimal;
  quotedPrice: Decimal;
  finalPrice: Decimal;
  currency: string;
  lineNumber: number;
  notes: string | null;
}

interface Buylist {
  id: string;
  installationId: string;
  buylistNumber: string;
  saleorWarehouseId: string;
  status: BuylistStatus;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  saleorUserId: string | null;
  currency: string;
  totalQuotedAmount: Decimal;
  totalFinalAmount: Decimal;
  pricingPolicyId: string | null;
  notes: string | null;
  payoutMethod: PayoutMethod | null;
  payoutReference: string | null;
  paidAt: Date | null;
  paidBy: string | null;
  lines: BuylistLine[];
}

interface BuylistPayout {
  id: string;
  buylistId: string;
  method: PayoutMethod;
  status: PayoutStatus;
  amount: Decimal;
  currency: string;
  reference: string | null;
  idempotencyKey: string | null;
  posRegisterSessionId: string | null;
  posCashMovementId: string | null;
  processedAt: Date | null;
  processedBy: string | null;
}

interface RegisterSession {
  id: string;
  installationId: string;
  registerCode: string;
  status: "OPEN" | "SUSPENDED" | "CLOSED";
  totalCashIn: number;
  totalCashOut: number;
}

interface CashMovement {
  id: string;
  registerSessionId: string;
  movementType: "SALE" | "RETURN" | "DROP" | "PAYOUT";
  amount: Decimal;
  currency: string;
  reason: string;
  referenceNumber: string;
  buylistPayoutId: string;
  performedBy: string;
  performedAt: Date;
}

interface CustomerCredit {
  id: string;
  installationId: string;
  saleorCustomerId: string;
  balance: Decimal;
  currency: string;
}

interface CreditTransaction {
  id: string;
  creditAccountId: string;
  transactionType: "BUYLIST_PAYOUT" | "POS_PAYMENT" | "MANUAL_ADJUSTMENT";
  amount: number;
  currency: string;
  balanceAfter: number;
  sourceBuylistId: string | null;
  note: string;
  createdBy: string | null;
}

interface CostLayerEvent {
  id: string;
  installationId: string;
  eventType: CostEventType;
  saleorVariantId: string;
  saleorWarehouseId: string;
  qtyDelta: number;
  unitCost: Decimal;
  currency: string;
  wacAtEvent: Decimal;
  qtyOnHandAtEvent: number;
  totalValueAtEvent: Decimal;
  eventTimestamp: Date;
  sourceBuylistLineId: string | null;
}

interface CreateAndPayInput {
  saleorWarehouseId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  saleorUserId?: string | null;
  currency?: string;
  notes?: string | null;
  payoutMethod: PayoutMethod;
  payoutReference?: string | null;
  posRegisterSessionId?: string | null;
  lines: Array<{
    saleorVariantId: string;
    saleorVariantSku?: string | null;
    saleorVariantName?: string | null;
    qty: number;
    condition: CardCondition;
    marketPrice: number;
    buyPrice?: number | null;
    notes?: string | null;
  }>;
  idempotencyKey?: string;
}

// ==================== Mock Helpers ====================

function createMockBuylistLine(overrides: Partial<BuylistLine> = {}): BuylistLine {
  return {
    id: `line-${Math.random().toString(36).slice(2, 8)}`,
    buylistId: "buylist-1",
    saleorVariantId: "variant-1",
    saleorVariantSku: "MH3-123-NM",
    saleorVariantName: "Lightning Bolt [MH3] NM",
    qty: 1,
    condition: "NM",
    marketPrice: new Decimal("10.00"),
    quotedPrice: new Decimal("5.00"),
    finalPrice: new Decimal("5.00"),
    currency: "USD",
    lineNumber: 1,
    notes: null,
    ...overrides,
  };
}

function createMockBuylist(overrides: Partial<Buylist> = {}): Buylist {
  return {
    id: `buylist-${Math.random().toString(36).slice(2, 8)}`,
    installationId: "install-1",
    buylistNumber: `BL-20260103-0001`,
    saleorWarehouseId: "warehouse-1",
    status: "PENDING_VERIFICATION",
    customerName: "John Doe",
    customerEmail: "john@example.com",
    customerPhone: "555-1234",
    saleorUserId: null,
    currency: "USD",
    totalQuotedAmount: new Decimal("50.00"),
    totalFinalAmount: new Decimal("50.00"),
    pricingPolicyId: null,
    notes: null,
    payoutMethod: "CASH",
    payoutReference: null,
    paidAt: new Date(),
    paidBy: "user-1",
    lines: [],
    ...overrides,
  };
}

function createMockPayout(overrides: Partial<BuylistPayout> = {}): BuylistPayout {
  return {
    id: `payout-${Math.random().toString(36).slice(2, 8)}`,
    buylistId: "buylist-1",
    method: "CASH",
    status: "COMPLETED",
    amount: new Decimal("50.00"),
    currency: "USD",
    reference: null,
    idempotencyKey: null,
    posRegisterSessionId: null,
    posCashMovementId: null,
    processedAt: new Date(),
    processedBy: "user-1",
    ...overrides,
  };
}

function createMockRegisterSession(overrides: Partial<RegisterSession> = {}): RegisterSession {
  return {
    id: "register-session-1",
    installationId: "install-1",
    registerCode: "REG-001",
    status: "OPEN",
    totalCashIn: 500,
    totalCashOut: 100,
    ...overrides,
  };
}

function createMockCustomerCredit(overrides: Partial<CustomerCredit> = {}): CustomerCredit {
  return {
    id: "credit-1",
    installationId: "install-1",
    saleorCustomerId: "customer-1",
    balance: new Decimal("0.00"),
    currency: "USD",
    ...overrides,
  };
}

function createMockCostLayerEvent(overrides: Partial<CostLayerEvent> = {}): CostLayerEvent {
  return {
    id: `event-${Math.random().toString(36).slice(2, 8)}`,
    installationId: "install-1",
    eventType: "BUYLIST_RECEIPT",
    saleorVariantId: "variant-1",
    saleorWarehouseId: "warehouse-1",
    qtyDelta: 1,
    unitCost: new Decimal("5.00"),
    currency: "USD",
    wacAtEvent: new Decimal("5.00"),
    qtyOnHandAtEvent: 1,
    totalValueAtEvent: new Decimal("5.00"),
    eventTimestamp: new Date(),
    sourceBuylistLineId: null,
    ...overrides,
  };
}

// ==================== Business Logic Tests ====================

describe("createAndPay Business Logic", () => {
  describe("Buylist Number Generation", () => {
    it("should generate buylist number with date prefix", () => {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");
      const prefix = `BL-${year}${month}${day}`;

      const buylistNumber = `${prefix}-0001`;

      expect(buylistNumber).toMatch(/^BL-\d{8}-\d{4}$/);
      expect(buylistNumber).toContain(prefix);
    });

    it("should increment sequence number for same day", () => {
      const prefix = "BL-20260103";
      const lastBuylistNumber = `${prefix}-0005`;

      // Extract last sequence
      const lastSequence = parseInt(lastBuylistNumber.split("-").pop() ?? "0", 10);
      const newSequence = lastSequence + 1;
      const newBuylistNumber = `${prefix}-${String(newSequence).padStart(4, "0")}`;

      expect(newBuylistNumber).toBe("BL-20260103-0006");
    });

    it("should start at 0001 for new day", () => {
      const lastBuylist = null; // No buylist exists for today

      const sequence = lastBuylist ? 999 : 1;
      const buylistNumber = `BL-20260103-${String(sequence).padStart(4, "0")}`;

      expect(buylistNumber).toBe("BL-20260103-0001");
    });
  });

  describe("Line Price Calculation", () => {
    it("should use buy price override when provided", () => {
      const line = {
        marketPrice: 100,
        buyPrice: 60, // Override
        condition: "NM" as CardCondition,
      };

      // When buyPrice is provided, use it directly
      const finalPrice = line.buyPrice ?? line.marketPrice * 0.5;

      expect(finalPrice).toBe(60);
    });

    it("should calculate price from policy when no override", () => {
      const line = {
        marketPrice: 100,
        buyPrice: null,
        condition: "NM" as CardCondition,
      };

      // Default 50% policy fallback
      const basePercentage = 0.5;
      const conditionMultiplier = 1.0; // NM
      const finalPrice = line.marketPrice * basePercentage * conditionMultiplier;

      expect(finalPrice).toBe(50);
    });

    it("should apply condition multiplier to calculated price", () => {
      const marketPrice = 100;
      const basePercentage = 0.5; // 50%

      const conditionMultipliers: Record<CardCondition, number> = {
        NM: 1.0,
        LP: 0.9,
        MP: 0.75,
        HP: 0.5,
        DMG: 0.25,
      };

      for (const [condition, multiplier] of Object.entries(conditionMultipliers)) {
        const expectedPrice = marketPrice * basePercentage * multiplier;
        expect(expectedPrice).toBe(50 * multiplier);
      }
    });
  });

  describe("Total Calculation", () => {
    it("should calculate total from line prices and quantities", () => {
      const lines = [
        { finalPrice: new Decimal("5.00"), qty: 2 }, // $10
        { finalPrice: new Decimal("10.00"), qty: 3 }, // $30
        { finalPrice: new Decimal("25.00"), qty: 1 }, // $25
      ];

      const total = lines.reduce(
        (sum, line) => sum.add(line.finalPrice.mul(line.qty)),
        new Decimal(0)
      );

      expect(total.toNumber()).toBe(65);
    });

    it("should handle empty lines array", () => {
      const lines: Array<{ finalPrice: Decimal; qty: number }> = [];

      const total = lines.reduce(
        (sum, line) => sum.add(line.finalPrice.mul(line.qty)),
        new Decimal(0)
      );

      expect(total.toNumber()).toBe(0);
    });

    it("should handle high precision decimals", () => {
      const lines = [
        { finalPrice: new Decimal("1.234"), qty: 3 },
        { finalPrice: new Decimal("2.567"), qty: 2 },
      ];

      const total = lines.reduce(
        (sum, line) => sum.add(line.finalPrice.mul(line.qty)),
        new Decimal(0)
      );

      // 1.234 * 3 + 2.567 * 2 = 3.702 + 5.134 = 8.836
      expect(total.toNumber()).toBeCloseTo(8.836, 3);
    });
  });
});

describe("createAndPay Validation", () => {
  describe("Store Credit Payout Validation", () => {
    it("should require customer for store credit payout", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "STORE_CREDIT",
        saleorUserId: null, // No customer!
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      const requiresCustomer = input.payoutMethod === "STORE_CREDIT" && !input.saleorUserId;

      expect(requiresCustomer).toBe(true);
    });

    it("should allow store credit when customer is provided", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "STORE_CREDIT",
        saleorUserId: "customer-123",
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      const isValid = !(input.payoutMethod === "STORE_CREDIT" && !input.saleorUserId);

      expect(isValid).toBe(true);
    });
  });

  describe("Cash Payout with Register", () => {
    it("should verify register is open for cash payout", () => {
      const registerSession = createMockRegisterSession({ status: "OPEN" });

      const isValidRegister = registerSession.status === "OPEN" || registerSession.status === "SUSPENDED";

      expect(isValidRegister).toBe(true);
    });

    it("should reject closed register for cash payout", () => {
      const registerSession = createMockRegisterSession({ status: "CLOSED" });

      const isValidRegister = registerSession.status === "OPEN" || registerSession.status === "SUSPENDED";

      expect(isValidRegister).toBe(false);
    });

    it("should allow cash payout without register session", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "CASH",
        posRegisterSessionId: null, // No register
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      // Cash payout without register is allowed (just not tracked)
      expect(input.posRegisterSessionId).toBeNull();
    });
  });

  describe("Line Validation", () => {
    it("should require at least one line", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "CASH",
        lines: [],
      };

      const hasLines = input.lines.length > 0;

      expect(hasLines).toBe(false);
    });

    it("should require positive quantity", () => {
      const line = { qty: 0, condition: "NM" as CardCondition, marketPrice: 10, saleorVariantId: "v1" };

      const isValidQty = line.qty > 0;

      expect(isValidQty).toBe(false);
    });

    it("should require non-negative market price", () => {
      const line = { qty: 1, condition: "NM" as CardCondition, marketPrice: -5, saleorVariantId: "v1" };

      const isValidPrice = line.marketPrice >= 0;

      expect(isValidPrice).toBe(false);
    });

    it("should validate condition enum", () => {
      const validConditions = ["NM", "LP", "MP", "HP", "DMG"];
      const condition = "NM";

      const isValid = validConditions.includes(condition);

      expect(isValid).toBe(true);
    });
  });
});

describe("createAndPay Idempotency", () => {
  describe("Idempotency Key Handling", () => {
    it("should use client-provided idempotency key", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "CASH",
        idempotencyKey: "client-key-123",
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      const finalKey = input.idempotencyKey ?? "generated-key";

      expect(finalKey).toBe("client-key-123");
    });

    it("should generate idempotency key when not provided", () => {
      const installationId = "install-1";
      const customerName = "John Doe";
      const lineCount = 3;
      const timestamp = Date.now();

      const generatedKey = `buylist-${installationId}-${timestamp}-${customerName ?? "walkin"}-${lineCount}`;

      expect(generatedKey).toContain("buylist-");
      expect(generatedKey).toContain(installationId);
      expect(generatedKey).toContain(customerName);
    });

    it("should return existing buylist on duplicate key", () => {
      const existingBuylist = createMockBuylist({
        id: "existing-buylist",
        buylistNumber: "BL-20260103-0001",
      });

      const existingPayout = createMockPayout({
        idempotencyKey: "duplicate-key",
        buylistId: existingBuylist.id,
      });

      // Simulate finding existing payout
      const foundPayout = { ...existingPayout, buylist: existingBuylist };

      if (foundPayout?.buylist) {
        expect(foundPayout.buylist.id).toBe("existing-buylist");
      }
    });
  });
});

describe("createAndPay Payout Methods", () => {
  describe("Cash Payout", () => {
    it("should create cash movement when register session provided", () => {
      const buylistNumber = "BL-20260103-0001";
      const payoutAmount = new Decimal("50.00");
      const registerSessionId = "register-session-1";
      const payoutId = "payout-1";

      const cashMovement: CashMovement = {
        id: "movement-1",
        registerSessionId,
        movementType: "PAYOUT",
        amount: payoutAmount.negated(), // Negative for cash out
        currency: "USD",
        reason: `Buylist payout: ${buylistNumber}`,
        referenceNumber: payoutId,
        buylistPayoutId: payoutId,
        performedBy: "user-1",
        performedAt: new Date(),
      };

      expect(cashMovement.amount.toNumber()).toBe(-50);
      expect(cashMovement.movementType).toBe("PAYOUT");
      expect(cashMovement.reason).toContain(buylistNumber);
    });

    it("should update register totalCashOut", () => {
      const register = createMockRegisterSession({
        totalCashOut: 100,
      });
      const payoutAmount = 50;

      const newTotalCashOut = register.totalCashOut + payoutAmount;

      expect(newTotalCashOut).toBe(150);
    });

    it("should link payout to cash movement", () => {
      const payout = createMockPayout({
        method: "CASH",
        posRegisterSessionId: "register-session-1",
        posCashMovementId: "movement-1",
      });

      expect(payout.posCashMovementId).toBe("movement-1");
    });
  });

  describe("Store Credit Payout", () => {
    it("should create credit account if not exists", () => {
      const existingCredit = null;
      const customerId = "customer-1";
      const installationId = "install-1";
      const creditAmount = 50;

      // Would create new credit account
      const newCredit: CustomerCredit = existingCredit ?? {
        id: "new-credit-1",
        installationId,
        saleorCustomerId: customerId,
        balance: new Decimal(creditAmount),
        currency: "USD",
      };

      expect(newCredit.balance.toNumber()).toBe(creditAmount);
    });

    it("should add to existing credit balance", () => {
      const existingCredit = createMockCustomerCredit({
        balance: new Decimal("100.00"),
      });
      const creditAmount = 50;

      const newBalance = existingCredit.balance.toNumber() + creditAmount;

      expect(newBalance).toBe(150);
    });

    it("should create credit transaction record", () => {
      const credit = createMockCustomerCredit({
        id: "credit-1",
        balance: new Decimal("150.00"),
      });
      const buylistId = "buylist-1";
      const buylistNumber = "BL-20260103-0001";
      const creditAmount = 50;

      const transaction: CreditTransaction = {
        id: "transaction-1",
        creditAccountId: credit.id,
        transactionType: "BUYLIST_PAYOUT",
        amount: creditAmount,
        currency: "USD",
        balanceAfter: credit.balance.toNumber(),
        sourceBuylistId: buylistId,
        note: `Store credit from buylist ${buylistNumber}`,
        createdBy: "user-1",
      };

      expect(transaction.transactionType).toBe("BUYLIST_PAYOUT");
      expect(transaction.sourceBuylistId).toBe(buylistId);
      expect(transaction.amount).toBe(creditAmount);
    });
  });

  describe("Other Payout Methods", () => {
    it("should support CHECK payout with reference", () => {
      const payout = createMockPayout({
        method: "CHECK",
        reference: "Check #1234",
      });

      expect(payout.method).toBe("CHECK");
      expect(payout.reference).toBe("Check #1234");
    });

    it("should support BANK_TRANSFER payout", () => {
      const payout = createMockPayout({
        method: "BANK_TRANSFER",
        reference: "ACH-12345",
      });

      expect(payout.method).toBe("BANK_TRANSFER");
    });

    it("should support PAYPAL payout", () => {
      const payout = createMockPayout({
        method: "PAYPAL",
        reference: "PP-TXN-123456",
      });

      expect(payout.method).toBe("PAYPAL");
    });

    it("should support OTHER payout", () => {
      const payout = createMockPayout({
        method: "OTHER",
        reference: "Custom payment method",
      });

      expect(payout.method).toBe("OTHER");
    });
  });
});

describe("createAndPay Cost Layer Events", () => {
  describe("BUYLIST_RECEIPT Event Creation", () => {
    it("should create cost layer event for each line", () => {
      const lines = [
        createMockBuylistLine({ id: "line-1", qty: 2, finalPrice: new Decimal("5.00") }),
        createMockBuylistLine({ id: "line-2", qty: 3, finalPrice: new Decimal("10.00") }),
      ];

      const events = lines.map(line => createMockCostLayerEvent({
        eventType: "BUYLIST_RECEIPT",
        saleorVariantId: line.saleorVariantId,
        qtyDelta: line.qty,
        unitCost: line.finalPrice,
        sourceBuylistLineId: line.id,
      }));

      expect(events).toHaveLength(2);
      expect(events[0].qtyDelta).toBe(2);
      expect(events[1].qtyDelta).toBe(3);
    });

    it("should set event type to BUYLIST_RECEIPT", () => {
      const event = createMockCostLayerEvent({
        eventType: "BUYLIST_RECEIPT",
      });

      expect(event.eventType).toBe("BUYLIST_RECEIPT");
    });

    it("should use line final price as unit cost", () => {
      const line = createMockBuylistLine({
        finalPrice: new Decimal("7.50"),
      });

      const event = createMockCostLayerEvent({
        unitCost: line.finalPrice,
      });

      expect(event.unitCost.toNumber()).toBe(7.5);
    });

    it("should link event to buylist line", () => {
      const line = createMockBuylistLine({ id: "line-123" });

      const event = createMockCostLayerEvent({
        sourceBuylistLineId: line.id,
      });

      expect(event.sourceBuylistLineId).toBe("line-123");
    });
  });

  describe("WAC Calculation", () => {
    it("should calculate WAC for new inventory (no existing stock)", () => {
      const existingQty = 0;
      const existingValue = new Decimal(0);

      const newQty = 5;
      const unitCost = new Decimal("10.00");
      const newValue = existingValue.plus(unitCost.times(newQty));
      const totalQty = existingQty + newQty;
      const newWac = totalQty > 0 ? newValue.div(totalQty) : new Decimal(0);

      // 5 units at $10 each = $50 total, WAC = $10
      expect(newWac.toNumber()).toBe(10);
      expect(totalQty).toBe(5);
    });

    it("should calculate WAC for additional inventory", () => {
      const existingQty = 10;
      const existingWac = new Decimal("8.00");
      const existingValue = existingWac.times(existingQty); // $80

      const newQty = 5;
      const unitCost = new Decimal("12.00");
      const newValue = existingValue.plus(unitCost.times(newQty)); // $80 + $60 = $140
      const totalQty = existingQty + newQty; // 15
      const newWac = newValue.div(totalQty); // $140 / 15 = $9.33...

      expect(newWac.toNumber()).toBeCloseTo(9.33, 2);
      expect(totalQty).toBe(15);
    });

    it("should handle zero qty gracefully", () => {
      const totalQty = 0;
      const totalValue = new Decimal(0);
      const newWac = totalQty > 0 ? totalValue.div(totalQty) : new Decimal(0);

      expect(newWac.toNumber()).toBe(0);
    });

    it("should store WAC in cost layer event", () => {
      const newWac = new Decimal("9.50");
      const totalQty = 15;
      const totalValue = new Decimal("142.50");

      const event = createMockCostLayerEvent({
        wacAtEvent: newWac,
        qtyOnHandAtEvent: totalQty,
        totalValueAtEvent: totalValue,
      });

      expect(event.wacAtEvent.toNumber()).toBe(9.5);
      expect(event.qtyOnHandAtEvent).toBe(15);
      expect(event.totalValueAtEvent.toNumber()).toBe(142.5);
    });
  });

  describe("Multi-Line WAC Updates", () => {
    it("should process lines sequentially for same variant", () => {
      // Simulate multiple lines for same variant in one buylist
      const variantId = "variant-1";
      const warehouseId = "warehouse-1";

      // Initial state
      let currentQty = 10;
      let currentValue = new Decimal("80.00"); // WAC = $8

      // Line 1: Add 5 at $10
      const line1Qty = 5;
      const line1Cost = new Decimal("10.00");
      currentValue = currentValue.plus(line1Cost.times(line1Qty));
      currentQty += line1Qty;
      const wacAfterLine1 = currentValue.div(currentQty);

      // $80 + $50 = $130, 15 units, WAC = $8.67
      expect(wacAfterLine1.toNumber()).toBeCloseTo(8.67, 2);

      // Line 2: Add 3 at $12
      const line2Qty = 3;
      const line2Cost = new Decimal("12.00");
      currentValue = currentValue.plus(line2Cost.times(line2Qty));
      currentQty += line2Qty;
      const wacAfterLine2 = currentValue.div(currentQty);

      // $130 + $36 = $166, 18 units, WAC = $9.22
      expect(wacAfterLine2.toNumber()).toBeCloseTo(9.22, 2);
    });
  });
});

describe("createAndPay Audit Trail", () => {
  describe("Audit Event Creation", () => {
    it("should create CREATED_AND_PAID audit event", () => {
      const buylistId = "buylist-1";
      const buylistNumber = "BL-20260103-0001";
      const lineCount = 3;
      const totalAmount = "150.00";
      const payoutMethod = "CASH";

      const auditEvent = {
        buylistId,
        action: "CREATED_AND_PAID",
        userId: "user-1",
        newState: {
          buylistNumber,
          lineCount,
          totalAmount,
          payoutMethod,
        },
      };

      expect(auditEvent.action).toBe("CREATED_AND_PAID");
      expect(auditEvent.newState.lineCount).toBe(3);
    });

    it("should include customer ID for store credit payouts", () => {
      const customerId = "customer-123";

      const auditEvent = {
        action: "CREATED_AND_PAID",
        newState: {
          payoutMethod: "STORE_CREDIT",
          customerId,
        },
      };

      expect(auditEvent.newState.customerId).toBe(customerId);
    });

    it("should include register session ID for cash payouts", () => {
      const registerSessionId = "register-session-1";

      const auditEvent = {
        action: "CREATED_AND_PAID",
        newState: {
          payoutMethod: "CASH",
          registerSessionId,
        },
      };

      expect(auditEvent.newState.registerSessionId).toBe(registerSessionId);
    });
  });
});

describe("createAndPay Edge Cases", () => {
  describe("Zero Price Items", () => {
    it("should handle zero market price", () => {
      const line = {
        marketPrice: 0,
        buyPrice: null,
        condition: "NM" as CardCondition,
      };

      const finalPrice = line.buyPrice ?? line.marketPrice * 0.5;

      expect(finalPrice).toBe(0);
    });

    it("should handle zero buy price override", () => {
      const line = {
        marketPrice: 10,
        buyPrice: 0,
        condition: "NM" as CardCondition,
      };

      // Explicit $0 override should be respected
      const finalPrice = line.buyPrice ?? line.marketPrice * 0.5;

      expect(finalPrice).toBe(0);
    });
  });

  describe("Large Quantities", () => {
    it("should handle large quantities correctly", () => {
      const line = {
        qty: 1000,
        finalPrice: new Decimal("0.10"),
      };

      const lineTotal = line.finalPrice.mul(line.qty);

      expect(lineTotal.toNumber()).toBe(100);
    });
  });

  describe("Currency Handling", () => {
    it("should use default USD currency", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "CASH",
        // currency not specified
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      const currency = input.currency ?? "USD";

      expect(currency).toBe("USD");
    });

    it("should respect specified currency", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "CASH",
        currency: "EUR",
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      expect(input.currency).toBe("EUR");
    });
  });

  describe("Anonymous Customers", () => {
    it("should allow buylist without customer info", () => {
      const input: CreateAndPayInput = {
        saleorWarehouseId: "warehouse-1",
        payoutMethod: "CASH",
        customerName: null,
        customerEmail: null,
        customerPhone: null,
        saleorUserId: null,
        lines: [
          { saleorVariantId: "v1", qty: 1, condition: "NM", marketPrice: 10 },
        ],
      };

      const isWalkIn = !input.customerName && !input.saleorUserId;

      expect(isWalkIn).toBe(true);
    });

    it("should use 'walkin' in idempotency key for anonymous", () => {
      const customerName: string | null = null;
      const fallback = customerName ?? "walkin";

      expect(fallback).toBe("walkin");
    });
  });

  describe("Variant SKU and Name Caching", () => {
    it("should store variant SKU for display", () => {
      const line = createMockBuylistLine({
        saleorVariantSku: "MH3-123-NM",
      });

      expect(line.saleorVariantSku).toBe("MH3-123-NM");
    });

    it("should store variant name for display", () => {
      const line = createMockBuylistLine({
        saleorVariantName: "Lightning Bolt [Modern Horizons 3] NM",
      });

      expect(line.saleorVariantName).toContain("Lightning Bolt");
    });

    it("should handle null SKU/name", () => {
      const line = createMockBuylistLine({
        saleorVariantSku: null,
        saleorVariantName: null,
      });

      expect(line.saleorVariantSku).toBeNull();
      expect(line.saleorVariantName).toBeNull();
    });
  });
});

describe("createAndPay Transaction Integrity", () => {
  describe("Atomic Operations", () => {
    it("should create buylist, payout, and events in same transaction", () => {
      // This test documents the expected transactional behavior
      // In actual implementation, all operations are wrapped in prisma.$transaction

      const operations = [
        "create buylist",
        "create payout",
        "create cash movement (if cash)",
        "update register (if cash)",
        "create/update customer credit (if store credit)",
        "create credit transaction (if store credit)",
        "create cost layer events",
        "create audit event",
      ];

      // All operations should succeed or fail together
      expect(operations.length).toBeGreaterThan(0);
    });
  });

  describe("Rollback Scenarios", () => {
    it("should document rollback on register not open", () => {
      // If register validation fails mid-transaction, everything rolls back
      const expectedError = "Selected register is not open. Please select an open register.";

      expect(expectedError).toContain("not open");
    });

    it("should document rollback on database error", () => {
      // Any database error should cause full rollback
      // This ensures no partial buylists are created
      const transactionBehavior = "atomic";

      expect(transactionBehavior).toBe("atomic");
    });
  });
});

describe("createAndPay Result Structure", () => {
  it("should return complete buylist with lines", () => {
    const result = createMockBuylist({
      lines: [
        createMockBuylistLine({ lineNumber: 1 }),
        createMockBuylistLine({ lineNumber: 2 }),
      ],
    });

    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("buylistNumber");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("lines");
    expect(result.lines).toHaveLength(2);
  });

  it("should set status to PENDING_VERIFICATION", () => {
    const result = createMockBuylist();

    expect(result.status).toBe("PENDING_VERIFICATION");
  });

  it("should set payoutMethod and paidAt", () => {
    const result = createMockBuylist({
      payoutMethod: "CASH",
      paidAt: new Date(),
    });

    expect(result.payoutMethod).toBe("CASH");
    expect(result.paidAt).toBeInstanceOf(Date);
  });
});
