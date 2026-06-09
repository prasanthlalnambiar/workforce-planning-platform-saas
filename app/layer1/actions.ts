'use server';

import { revalidatePath } from 'next/cache';
import {
  createDemandInput,
  createLayer1Assumptions,
  createPlanningBrief,
  createScenarioDefinition,
  createSourceInventoryItem,
  runLayer1Calculation
} from '../../lib/repositories/layer1';
import { requireUserContext } from '../../lib/auth/session';

const layer1Paths = ['/layer1', '/layer1/brief', '/layer1/sources', '/layer1/demand', '/layer1/assumptions', '/layer1/output', '/layer1/scenarios'];

function valuesFrom(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) values[key] = value;
  return values;
}

function revalidateLayer1() {
  for (const path of layer1Paths) revalidatePath(path);
}

export async function createPlanningBriefAction(formData: FormData) {
  const context = await requireUserContext();
  await createPlanningBrief(context, valuesFrom(formData));
  revalidateLayer1();
}

export async function createSourceInventoryAction(formData: FormData) {
  const context = await requireUserContext();
  await createSourceInventoryItem(context, valuesFrom(formData));
  revalidateLayer1();
}

export async function createDemandInputAction(formData: FormData) {
  const context = await requireUserContext();
  await createDemandInput(context, valuesFrom(formData));
  revalidateLayer1();
}

export async function createLayer1AssumptionsAction(formData: FormData) {
  const context = await requireUserContext();
  await createLayer1Assumptions(context, valuesFrom(formData));
  revalidateLayer1();
}

export async function createScenarioDefinitionAction(formData: FormData) {
  const context = await requireUserContext();
  await createScenarioDefinition(context, valuesFrom(formData));
  revalidateLayer1();
}

export async function runLayer1CalculationAction(formData: FormData) {
  const context = await requireUserContext();
  await runLayer1Calculation(context, String(formData.get('plan_id') ?? ''));
  revalidateLayer1();
}
