ALTER TABLE `assets` ADD `folder` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `tags` text;--> statement-breakpoint
CREATE INDEX `idx_assets_folder` ON `assets` (`folder`);