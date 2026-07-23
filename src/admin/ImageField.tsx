import { useCallback, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { type ImageAsset } from "./api";
import { ImagePicker } from "./ImagePicker";

type ImageFieldProps = {
  label: string;
  value: ImageAsset | null;
  onChange: (image: ImageAsset | null) => void;
};

export function ImageField({ label, value, onChange }: ImageFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  return (
    <div className="admin-image-field">
      <span>{label}</span>
      {value ? (
        <div className="admin-image-field-value">
          <img src={value.variants.thumbnail?.url ?? value.url} alt={value.altText || ""} />
          <div><strong>{value.originalFilename}</strong><small>{value.width} × {value.height}</small></div>
          <button type="button" onClick={() => onChange(null)} aria-label="Убрать изображение"><Trash2 size={17} /></button>
        </div>
      ) : null}
      <button className="admin-secondary-button" type="button" onClick={() => setPickerOpen(true)}>
        <ImagePlus size={17} />{value ? "Заменить" : "Выбрать из медиатеки"}
      </button>
      <ImagePicker open={pickerOpen} selectedId={value?.id} onSelect={onChange} onClose={closePicker} />
    </div>
  );
}
