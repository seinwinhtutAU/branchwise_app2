import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { type Session } from "@renderer/lib/auth";
import {
  CARGO_COMPANIES_URL,
  CARRIERS_URL,
  CUSTOMERS_URL,
  DESTINATIONS_URL,
  productsFromWire,
  RECEIVING_GATES_URL,
  SUPPLIERS_URL,
  WHOLESALE_PRODUCTS_URL,
  type WholesaleCustomerWire,
  type WholesaleNamedEntityWire,
  type WholesaleProductWire,
} from "./api";
import { type Product } from "./products";

export interface MasterDataCustomer {
  name: string;
  phone: string;
  address: string;
}

const initialProducts: Product[] = [
  {
    stock_code: "A1001",
    description: "Men's leather sandal",
    product_group: "man",
    default_unit: "set",
  },
  {
    stock_code: "A1002",
    description: "Men's slipper",
    product_group: "man",
    default_unit: "set",
  },
  {
    stock_code: "A1003",
    description: "Men's sport sandal",
    product_group: "man",
    default_unit: "set",
  },
  {
    stock_code: "B2001",
    description: "Ladies' flat sandal",
    product_group: "lady",
    default_unit: "set",
  },
  {
    stock_code: "B2002",
    description: "Ladies' heel sandal",
    product_group: "lady",
    default_unit: "set",
  },
  {
    stock_code: "C3001",
    description: "Kids' school shoe",
    product_group: "child",
    default_unit: "set",
  },
  {
    stock_code: "C3002",
    description: "Kids' sandal",
    product_group: "child",
    default_unit: "set",
  },
  {
    stock_code: "D4001",
    description: "Ladies' rubber slipper",
    product_group: "lady",
    default_unit: "set",
  },
];

export const SEED_PRODUCTS: Product[] = [...initialProducts];
export const STOCK_CODES: string[] = initialProducts.map(
  (product) => product.stock_code,
);
export const SUPPLIER_NAMES = [
  "Goody Factory",
  "Lek",
  "Nilin",
  "Maldini",
  "Panda Shoes",
];
export const KNOWN_CUSTOMERS: MasterDataCustomer[] = [
  {
    name: "Ma Su Su Hlaing",
    phone: "09-4500-12345",
    address: "No. 24, Bogyoke Rd, Mawlamyine",
  },
  {
    name: "Pone Pone",
    phone: "09-9600-23456",
    address: "112 Anawrahta Rd, Yangon",
  },
  {
    name: "Ko Kaung Htet",
    phone: "09-7800-34567",
    address: "Zay Gyi Market, Magway",
  },
  {
    name: "KKNN",
    phone: "09-4500-45678",
    address: "Shwe Taung St, Mawlamyine",
  },
  {
    name: "Ma Kyi Phyu",
    phone: "09-9600-56789",
    address: "5 Ward, Insein, Yangon",
  },
  { name: "MPPA", phone: "09-7800-67890", address: "78th St, Mandalay" },
];
export const CARGO_NAMES = [
  "Shwe Moe Cargo",
  "Ayar Cargo",
  "Tiger Cargo",
  "Golden Sea Cargo",
];
export const CARRIER_NAMES = [
  "U Hla Myint",
  "Ko Zaw Lin",
  "Ma Khin Khin",
  "U Kyaw Thu",
];
export const DESTINATION_NAMES = [
  "Yangon",
  "Mandalay",
  "Magway",
  "Mawlamyine",
  "Bago",
];
export const RECEIVING_GATES = [
  "Bogyoke Rd, Mawlamyine",
  "Zay Gyi St, Magway",
  "Anawrahta Rd, Yangon",
];

export interface MasterDataState {
  products: Product[];
  suppliers: string[];
  customers: MasterDataCustomer[];
  cargoCompanies: string[];
  carriers: string[];
  destinations: string[];
  receivingGates: string[];
}

let state: MasterDataState = {
  products: SEED_PRODUCTS,
  suppliers: SUPPLIER_NAMES,
  customers: KNOWN_CUSTOMERS,
  cargoCompanies: CARGO_NAMES,
  carriers: CARRIER_NAMES,
  destinations: DESTINATION_NAMES,
  receivingGates: RECEIVING_GATES,
};
const listeners = new Set<() => void>();

function replace<T>(target: T[], rows: T[]): void {
  target.splice(0, target.length, ...rows);
}

function publish(patch: Partial<MasterDataState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMasterData(): MasterDataState {
  return useSyncExternalStore(subscribe, () => state);
}

export function productOf(stockCode: string): Product | undefined {
  const code = stockCode.trim().toUpperCase();
  return SEED_PRODUCTS.find((product) => product.stock_code === code);
}

export function hydrateProducts(wires: WholesaleProductWire[]): void {
  const products = productsFromWire(wires);
  replace(SEED_PRODUCTS, products);
  replace(
    STOCK_CODES,
    products.map((product) => product.stock_code),
  );
  publish({ products: SEED_PRODUCTS });
}

function hydrateNames(
  target: string[],
  wires: WholesaleNamedEntityWire[],
  key: keyof MasterDataState,
): void {
  const names = wires.map((wire) => wire.name);
  replace(target, names);
  publish({ [key]: target } as Partial<MasterDataState>);
}

export function hydrateSuppliers(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(SUPPLIER_NAMES, wires, "suppliers");
}
export function hydrateCargoCompanies(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(CARGO_NAMES, wires, "cargoCompanies");
}
export function hydrateCarriers(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(CARRIER_NAMES, wires, "carriers");
}
export function hydrateDestinations(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(DESTINATION_NAMES, wires, "destinations");
}
export function hydrateReceivingGates(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(RECEIVING_GATES, wires, "receivingGates");
}

export function hydrateCustomers(wires: WholesaleCustomerWire[]): void {
  const customers = wires.map(({ name, phone, address }) => ({
    name,
    phone,
    address,
  }));
  replace(KNOWN_CUSTOMERS, customers);
  publish({ customers: KNOWN_CUSTOMERS });
}

/** Fetches all reference data once for whichever wholesale page is open. */
export function useHydrateMasterData(session: Session): void {
  const products = useQuery({
    queryKey: ["wholesale", "master-data", "products"],
    queryFn: () =>
      fetchJson<WholesaleProductWire[]>(WHOLESALE_PRODUCTS_URL, session),
  });
  const suppliers = useQuery({
    queryKey: ["wholesale", "master-data", "suppliers"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(SUPPLIERS_URL, session),
  });
  const customers = useQuery({
    queryKey: ["wholesale", "master-data", "customers"],
    queryFn: () => fetchJson<WholesaleCustomerWire[]>(CUSTOMERS_URL, session),
  });
  const cargoCompanies = useQuery({
    queryKey: ["wholesale", "master-data", "cargo-companies"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(CARGO_COMPANIES_URL, session),
  });
  const carriers = useQuery({
    queryKey: ["wholesale", "master-data", "carriers"],
    queryFn: () => fetchJson<WholesaleNamedEntityWire[]>(CARRIERS_URL, session),
  });
  const destinations = useQuery({
    queryKey: ["wholesale", "master-data", "destinations"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(DESTINATIONS_URL, session),
  });
  const receivingGates = useQuery({
    queryKey: ["wholesale", "master-data", "receiving-gates"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(RECEIVING_GATES_URL, session),
  });

  useMasterData();
  useLoadErrorToast(
    products.isError ||
      suppliers.isError ||
      customers.isError ||
      cargoCompanies.isError ||
      carriers.isError ||
      destinations.isError ||
      receivingGates.isError,
    "wholesale master data",
  );
  useEffect(() => {
    if (products.data) hydrateProducts(products.data);
  }, [products.data]);
  useEffect(() => {
    if (suppliers.data) hydrateSuppliers(suppliers.data);
  }, [suppliers.data]);
  useEffect(() => {
    if (customers.data) hydrateCustomers(customers.data);
  }, [customers.data]);
  useEffect(() => {
    if (cargoCompanies.data) hydrateCargoCompanies(cargoCompanies.data);
  }, [cargoCompanies.data]);
  useEffect(() => {
    if (carriers.data) hydrateCarriers(carriers.data);
  }, [carriers.data]);
  useEffect(() => {
    if (destinations.data) hydrateDestinations(destinations.data);
  }, [destinations.data]);
  useEffect(() => {
    if (receivingGates.data) hydrateReceivingGates(receivingGates.data);
  }, [receivingGates.data]);
}
