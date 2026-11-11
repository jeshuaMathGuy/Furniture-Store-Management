-- targets: app
-- Persistence for guided lab executions (Stage 7 fills these in).

CREATE TABLE demo_scenario (
    scenario_id   VARCHAR(60) PRIMARY KEY,
    title         VARCHAR(140) NOT NULL,
    category      ENUM('procedure','trigger','function','transaction','concurrency','normalization','query','integrity') NOT NULL,
    description   VARCHAR(1000) NOT NULL,
    is_mutating   BOOLEAN NOT NULL
) ENGINE=InnoDB;

CREATE TABLE demo_execution (
    execution_id  CHAR(36) PRIMARY KEY,
    scenario_id   VARCHAR(60) NOT NULL,
    user_id       INT NULL,
    status        ENUM('committed','rolled_back','failed','read_only') NOT NULL,
    provenance    ENUM('observed','instructional_simulation') NOT NULL,
    input         JSON NOT NULL,
    trace         JSON NOT NULL,
    started_at    DATETIME(3) NOT NULL,
    finished_at   DATETIME(3) NOT NULL,
    CONSTRAINT chk_execution_time CHECK (finished_at >= started_at),
    CONSTRAINT fk_execution_scenario FOREIGN KEY (scenario_id) REFERENCES demo_scenario(scenario_id) ON DELETE CASCADE,
    CONSTRAINT fk_execution_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE SET NULL,
    INDEX idx_execution_scenario (scenario_id, started_at)
) ENGINE=InnoDB;

CREATE TABLE demo_execution_step (
    execution_id  CHAR(36) NOT NULL,
    step_no       SMALLINT NOT NULL,
    kind          ENUM('statement','milestone','trigger_effect','outcome','error') NOT NULL,
    label         VARCHAR(500) NOT NULL,
    affected_rows INT NULL,
    PRIMARY KEY (execution_id, step_no),
    CONSTRAINT fk_step_execution FOREIGN KEY (execution_id) REFERENCES demo_execution(execution_id) ON DELETE CASCADE
) ENGINE=InnoDB;
