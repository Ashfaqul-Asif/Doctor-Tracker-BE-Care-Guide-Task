import { model, Schema, type HydratedDocument, type Model } from 'mongoose';
import { searchableName } from './plugins/searchableName.js';

export interface DoctorAttrs {
  name: string;
  /** Lowercased word tokens of `name` — see the searchableName plugin. */
  nameTokens: string[];
  specialization: string;
  hospital: string;
  phone: string;
  email: string;
  /** Soft delete (FR-17). `null` means live. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DoctorDocument = HydratedDocument<DoctorAttrs>;

const doctorSchema = new Schema<DoctorAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameTokens: { type: [String], required: true, default: [] },
    specialization: { type: String, required: true, trim: true, maxlength: 120 },
    hospital: { type: String, required: true, trim: true, maxlength: 160 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        return ret;
      },
    },
  },
);

doctorSchema.plugin(searchableName);

/**
 * Index strategy.
 *
 * Every list query filters `deletedAt: null`, so it leads each compound index — an
 * index whose leading field isn't in the predicate can't be used for that predicate.
 * `createdAt: -1` trails each one because it is the default sort, letting Mongo satisfy
 * the sort from the index instead of running a blocking in-memory SORT stage.
 */
doctorSchema.index({ deletedAt: 1, createdAt: -1 });
doctorSchema.index({ deletedAt: 1, specialization: 1, createdAt: -1 });
doctorSchema.index({ deletedAt: 1, hospital: 1, createdAt: -1 });
/** Multikey — one index entry per token, so any word of the name is searchable. */
doctorSchema.index({ deletedAt: 1, nameTokens: 1 });

/**
 * A doctor's email is their identity on the roster, so a duplicate is a data-entry
 * mistake rather than a legitimate second record. Enforced here rather than with a
 * read-then-write check in the service, which races under concurrent creates.
 *
 * This is what makes the documented 409 (docs/api.md) reachable: the duplicate-key
 * branch in `errorHandler` translates the driver's 11000 into it.
 *
 * Deliberately not partial on `deletedAt: null` — doctors have no delete endpoint, so
 * no soft-deleted row can ever hold an email hostage. Revisit alongside FR-17 if that
 * changes.
 */
doctorSchema.index({ email: 1 }, { unique: true });

export const Doctor: Model<DoctorAttrs> = model<DoctorAttrs>('Doctor', doctorSchema);
