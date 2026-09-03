"use client";

import * as React from "react";

const FormFieldContext = React.createContext<{
  id?: string;
  error?: { message?: string };
  formItemId?: string;
  formDescriptionId?: string;
  formMessageId?: string;
}>({});

export const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }
  const { id } = fieldContext;
  const fieldState = {
    id,
    formItemId: `form-item-${id}`,
    formDescriptionId: `form-item-${id}-description`,
    formMessageId: `form-item-${id}-message`,
  };
  return {
    ...fieldContext,
    ...fieldState,
  };
};

export const FormField = (props: React.HTMLAttributes<HTMLFormElement>) => <form {...props} />;
