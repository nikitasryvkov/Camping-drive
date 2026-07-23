ALTER TABLE news
  DROP CONSTRAINT news_cover_image_id_fkey,
  ADD CONSTRAINT news_cover_image_id_fkey
    FOREIGN KEY (cover_image_id) REFERENCES images(id) ON DELETE RESTRICT;
