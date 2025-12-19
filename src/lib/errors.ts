import ModernError from "modern-errors";
import modernErrorsSerialize from "modern-errors-serialize";

export const BaseError = ModernError.subclass("BaseError", {
  plugins: [modernErrorsSerialize],
  serialize: {
    exclude: ["stack"],
  },
  props: {
    _internalName: "change_me",
  } satisfies {
    _internalName: string;
  },
});

export const UnknownError = BaseError.subclass("UnknownError");

export const ValueError = BaseError.subclass("ValueError");

export const NotFoundError = BaseError.subclass("NotFoundError");

export const ValidationError = BaseError.subclass("ValidationError");

export const PermissionError = BaseError.subclass("PermissionError");

export const SaleorApiError = BaseError.subclass("SaleorApiError");

export const PricingError = BaseError.subclass("PricingError");

export const BuylistError = BaseError.subclass("BuylistError");
