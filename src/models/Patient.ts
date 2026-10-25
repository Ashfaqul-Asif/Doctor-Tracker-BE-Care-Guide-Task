import { model, Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { searchableName } from './plugins/searchableName.js';

export interface PatientAttrs {
  name: string;
  /** Lowercased word tokens of `name` — see the searchableName plugin. */
  nameTokens: string[];
  condition: string;
  /** FR-16: required — a patient never exists orphaned from a doctor. */
  doctorId: Types.ObjectId;
  contactInfo: string;
  /** Soft delete (FR-17). `null` means live. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PatientDocument = HydratedDocument<PatientAttrs>;

const patientSchema = new Schema<PatientAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameTokens: { type: [String], required: true, default: [] },
    condition: { type: String, required: true, trim: true, maxlength: 160 },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    contactInfo: { type: String, required: true, trim: true, maxlength: 200 },
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

patientSchema.plugin(searchableName);

/**
 * `{ deletedAt, doctorId, createdAt }` is the most important index in the application:
 * "list this doctor's patients" (FR-11) is the single most frequent query, and it is
 * also what the doctor detail page paginates.
 */
patientSchema.index({ deletedAt: 1, doctorId: 1, createdAt: -1 });
patientSchema.index({ deletedAt: 1, createdAt: -1 });
patientSchema.index({ deletedAt: 1, condition: 1, createdAt: -1 });
/** Multikey — one index entry per token, so any word of the name is searchable. */
patientSchema.index({ deletedAt: 1, nameTokens: 1 });

export const Patient: Model<PatientAttrs> = model<PatientAttrs>('Patient', patientSchema);
