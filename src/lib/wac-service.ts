/**
 * WAC (Weighted Average Cost) Calculation Service
 *
 * WAC Formula:
 * New WAC = (Existing Qty × Existing WAC + New Qty × New Unit Cost) / (Existing Qty + New Qty)
 *
 * This service computes the running WAC for inventory costing purposes.
 * It mirrors the implementation in inventory-ops to ensure consistent cost tracking
 * across both goods receipts and buylist receipts.
 */
import type { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

interface ComputeWacParams {
  prisma: PrismaClient;
  installationId: string;
  variantId: string;
  warehouseId: string;
  newQtyDelta: number;
  newUnitCost: Decimal;
  newLandedCostDelta?: Decimal;
}

/**
 * Compute WAC at the time of a new event (for storing in wacAtEvent field)
 *
 * This calculates what the WAC will be AFTER the new event is applied,
 * including all existing cost layer events plus the new transaction.
 */
export async function computeWacForNewEvent(
  params: ComputeWacParams
): Promise<{ wacAtEvent: Decimal; qtyOnHandAtEvent: number }> {
  const {
    prisma,
    installationId,
    variantId,
    warehouseId,
    newQtyDelta,
    newUnitCost,
    newLandedCostDelta = new Decimal(0),
  } = params;

  // Get all existing cost layer events for this variant/warehouse
  const events = await prisma.costLayerEvent.findMany({
    where: {
      installationId,
      saleorVariantId: variantId,
      saleorWarehouseId: warehouseId,
    },
    orderBy: { eventTimestamp: "asc" },
  });

  let runningQty = 0;
  let runningValue = new Decimal(0);

  // Process all existing events to get current state
  for (const event of events) {
    const eventUnitCost = new Decimal(event.unitCost.toString());
    const eventLandedCost = new Decimal(event.landedCostDelta?.toString() || "0");
    const totalUnitCost = eventUnitCost.plus(eventLandedCost);

    if (event.qtyDelta > 0) {
      // Receipt: add value at incoming cost
      runningValue = runningValue.plus(totalUnitCost.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    } else {
      // Issue/sale: remove value at current WAC
      const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
      runningValue = runningValue.plus(currentWac.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    }

    // Prevent negative inventory scenarios
    if (runningQty < 0) {
      runningQty = 0;
      runningValue = new Decimal(0);
    }
  }

  // Now apply the new event
  const totalNewCost = newUnitCost.plus(newLandedCostDelta);

  if (newQtyDelta > 0) {
    // Receipt: add value at incoming cost
    runningValue = runningValue.plus(totalNewCost.times(newQtyDelta));
    runningQty += newQtyDelta;
  } else {
    // Issue: remove value at current WAC
    const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
    runningValue = runningValue.plus(currentWac.times(newQtyDelta));
    runningQty += newQtyDelta;
  }

  // Prevent negative inventory scenarios
  if (runningQty < 0) {
    runningQty = 0;
    runningValue = new Decimal(0);
  }

  // Calculate final WAC
  const wacAtEvent = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);

  return {
    wacAtEvent,
    qtyOnHandAtEvent: runningQty,
  };
}

/**
 * Calculate current WAC for a specific variant/warehouse combination
 * (without adding a new event)
 */
export async function calculateCurrentWac(params: {
  prisma: PrismaClient;
  installationId: string;
  variantId: string;
  warehouseId: string;
}): Promise<{ wac: Decimal; qtyOnHand: number; totalValue: Decimal }> {
  const { prisma, installationId, variantId, warehouseId } = params;

  const events = await prisma.costLayerEvent.findMany({
    where: {
      installationId,
      saleorVariantId: variantId,
      saleorWarehouseId: warehouseId,
    },
    orderBy: { eventTimestamp: "asc" },
  });

  let runningQty = 0;
  let runningValue = new Decimal(0);

  for (const event of events) {
    const eventUnitCost = new Decimal(event.unitCost.toString());
    const eventLandedCost = new Decimal(event.landedCostDelta?.toString() || "0");
    const totalUnitCost = eventUnitCost.plus(eventLandedCost);

    if (event.qtyDelta > 0) {
      runningValue = runningValue.plus(totalUnitCost.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    } else {
      const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
      runningValue = runningValue.plus(currentWac.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    }

    if (runningQty < 0) {
      runningQty = 0;
      runningValue = new Decimal(0);
    }
  }

  const wac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);

  return {
    wac,
    qtyOnHand: runningQty,
    totalValue: runningValue,
  };
}
